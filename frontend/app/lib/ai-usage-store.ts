import { Prisma } from '@prisma/client';
import {
    calculateFixedMediaBilling,
    calculateTextUsageBilling,
    isExternallyBilledAccount,
    normalizeBillingAudience,
    type AiTokenUsage,
    type BillingAudience,
} from './ai-usage';
import { AppError, ensureAccessControlBootstrap } from './auth';
import { prisma } from './prisma';
import {
    isRetryableTransactionError,
    waitForTransactionRetry,
} from './transaction-retry';
import {
    planVideoCreditTransition,
    readActiveVideoHeldPoints,
} from './video-credit-reservation-state';

const USAGE_TRANSACTION_OPTIONS = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 20_000,
} as const;
const USAGE_TRANSACTION_ATTEMPTS = 3;

export type FixedMediaProduct = 'seedance2' | 'seedance2-fast' | 'nanobanana2';

export type RecordAiUsageEventInput = {
    userId: string;
    userEmail?: string | null;
    userNickname?: string | null;
    userGroup?: string | null;
    billingAudience?: BillingAudience;
    appId: string;
    channel: string;
    providerId?: string | null;
    model: string;
    requestId: string;
    upstreamRequestId?: string | null;
    upstreamTraceId?: string | null;
    upstreamUrl?: string | null;
    status?: 'succeeded' | 'failed';
    errorMessage?: string | null;
    usage?: AiTokenUsage | null;
    usageSource?: 'response' | 'yunwu_log' | 'estimated';
    groupMultiplier?: number;
    usdCnyRate?: number;
    mediaProduct?: FixedMediaProduct;
    billableUnits?: number;
};

type AiUsageCreditKey = {
    userId: string;
    channel: string;
    requestId: string;
};

function reservationReference(channel: string, requestId: string): string {
    return `usage-reserve:${channel}:${requestId}`;
}

function settlementReference(channel: string, requestId: string): string {
    return `usage-settle:${channel}:${requestId}`;
}

function toBigInt(value: number | undefined | null): bigint | null {
    if (!Number.isFinite(value) || Number(value) < 0) return null;
    return BigInt(Math.trunc(Number(value)));
}

async function claimSpendableCredits(
    tx: Prisma.TransactionClient,
    input: {
        userId: string;
        amount: number;
        requireActiveExternal?: boolean;
    },
): Promise<boolean> {
    const account = await tx.user.findUnique({
        where: { id: input.userId },
        select: { pointsBalance: true },
    });
    if (!account) return false;

    const heldPoints = await readActiveVideoHeldPoints(tx, input.userId);
    const transition = planVideoCreditTransition({
        action: 'reserve',
        pointsBalance: account.pointsBalance,
        heldPoints,
        amount: input.amount,
    });
    if (!transition.allowed) return false;

    const claimed = await tx.user.updateMany({
        where: {
            id: input.userId,
            ...(input.requireActiveExternal ? {
                accountStatus: 'active',
                billingAudience: 'external',
            } : {}),
            pointsBalance: { gte: heldPoints + input.amount },
        },
        data: {
            pointsBalance: { decrement: input.amount },
        },
    });
    return claimed.count === 1;
}

export async function reserveAiUsageCredits(input: AiUsageCreditKey & {
    amount: number;
    description: string;
}): Promise<number> {
    await ensureAccessControlBootstrap();

    const amount = Math.max(0, Math.trunc(input.amount));
    const referenceKey = reservationReference(input.channel, input.requestId);

    for (let attempt = 0; attempt < USAGE_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            return await prisma.$transaction(async (tx) => {
                const user = await tx.user.findUnique({
                    where: { id: input.userId },
                    select: {
                        billingAudience: true,
                        accountStatus: true,
                        role: true,
                    },
                });
                if (!user) {
                    throw new AppError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');
                }
                if (user.accountStatus !== 'active') {
                    throw new AppError('This account has been suspended.', 403, 'ACCOUNT_SUSPENDED');
                }
                if (!isExternallyBilledAccount(user)) {
                    return 0;
                }
                if (amount <= 0) {
                    throw new AppError(
                        'This model is not available for external credit billing.',
                        403,
                        'MODEL_NOT_AVAILABLE_FOR_EXTERNAL_BILLING',
                    );
                }

                const existing = await tx.pointsTransaction.findUnique({
                    where: { referenceKey },
                    select: {
                        amount: true,
                        userId: true,
                    },
                });
                if (existing) {
                    if (existing.userId !== input.userId) {
                        throw new AppError(
                            'A credit reservation cannot be reassigned to another account.',
                            409,
                            'CREDIT_RESERVATION_OWNER_MISMATCH',
                        );
                    }
                    return Math.max(0, -existing.amount);
                }

                const claimed = await claimSpendableCredits(tx, {
                    userId: input.userId,
                    amount,
                    requireActiveExternal: true,
                });
                if (!claimed) {
                    throw new AppError(
                        `Insufficient credits. This request requires up to ${amount} credits.`,
                        402,
                        'INSUFFICIENT_CREDITS',
                    );
                }

                const updatedUser = await tx.user.findUniqueOrThrow({
                    where: { id: input.userId },
                    select: { pointsBalance: true },
                });
                await tx.pointsTransaction.create({
                    data: {
                        userId: input.userId,
                        type: 'reserve',
                        amount: -amount,
                        balanceAfter: updatedUser.pointsBalance,
                        description: input.description,
                        referenceKey,
                    },
                });

                return amount;
            }, USAGE_TRANSACTION_OPTIONS);
        } catch (error) {
            if (!isRetryableTransactionError(error)) {
                throw error;
            }
            if (attempt >= USAGE_TRANSACTION_ATTEMPTS - 1) {
                break;
            }
            await waitForTransactionRetry(attempt);
        }
    }

    throw new AppError('Unable to reserve credits.', 503, 'CREDIT_RESERVATION_UNAVAILABLE');
}

export async function releaseAiUsageCredits(input: AiUsageCreditKey): Promise<void> {
    await ensureAccessControlBootstrap();

    const reserveReferenceKey = reservationReference(input.channel, input.requestId);
    const settleReferenceKey = settlementReference(input.channel, input.requestId);

    for (let attempt = 0; attempt < USAGE_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            await prisma.$transaction(async (tx) => {
                const reservation = await tx.pointsTransaction.findUnique({
                    where: { referenceKey: reserveReferenceKey },
                    select: {
                        amount: true,
                        userId: true,
                    },
                });
                const settlement = await tx.pointsTransaction.findUnique({
                    where: { referenceKey: settleReferenceKey },
                    select: {
                        id: true,
                        userId: true,
                    },
                });
                if (!reservation || settlement) {
                    if (reservation && reservation.userId !== input.userId) {
                        throw new AppError(
                            'A credit reservation cannot be released by another account.',
                            409,
                            'CREDIT_RESERVATION_OWNER_MISMATCH',
                        );
                    }
                    if (settlement && settlement.userId !== input.userId) {
                        throw new AppError(
                            'A credit settlement cannot be reassigned to another account.',
                            409,
                            'CREDIT_SETTLEMENT_OWNER_MISMATCH',
                        );
                    }
                    return;
                }
                if (reservation.userId !== input.userId) {
                    throw new AppError(
                        'A credit reservation cannot be released by another account.',
                        409,
                        'CREDIT_RESERVATION_OWNER_MISMATCH',
                    );
                }

                const reservedAmount = Math.max(0, -reservation.amount);
                const updatedUser = await tx.user.update({
                    where: { id: input.userId },
                    data: {
                        pointsBalance: { increment: reservedAmount },
                    },
                    select: { pointsBalance: true },
                });
                await tx.pointsTransaction.create({
                    data: {
                        userId: input.userId,
                        type: 'refund',
                        amount: reservedAmount,
                        balanceAfter: updatedUser.pointsBalance,
                        description: 'AI 请求未计费，已退回预留积分',
                        referenceKey: settleReferenceKey,
                    },
                });
            }, USAGE_TRANSACTION_OPTIONS);
            return;
        } catch (error) {
            if (!isRetryableTransactionError(error)) {
                throw error;
            }
            if (attempt >= USAGE_TRANSACTION_ATTEMPTS - 1) {
                break;
            }
            await waitForTransactionRetry(attempt);
        }
    }

    throw new AppError('Unable to release reserved credits.', 503, 'CREDIT_RELEASE_UNAVAILABLE');
}

export async function recordAiUsageEvent(input: RecordAiUsageEventInput) {
    await ensureAccessControlBootstrap();

    const userId = input.userId.trim();
    const appId = input.appId.trim();
    const channel = input.channel.trim();
    const model = input.model.trim();
    const requestId = input.requestId.trim();
    if (!userId || !appId || !channel || !model || !requestId) {
        throw new Error('userId, appId, channel, model and requestId are required');
    }

    const billingOwner = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            billingAudience: true,
            role: true,
        },
    });
    if (!billingOwner) {
        throw new AppError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');
    }
    const billingAudience = isExternallyBilledAccount(billingOwner)
        ? normalizeBillingAudience(billingOwner.billingAudience)
        : 'internal';
    const billing = input.mediaProduct
        ? calculateFixedMediaBilling({
            product: input.mediaProduct,
            units: input.billableUnits || 0,
            billingAudience,
        })
        : input.usage
            ? calculateTextUsageBilling({
                model,
                usage: input.usage,
                billingAudience,
                groupMultiplier: input.groupMultiplier,
                usdCnyRate: input.usdCnyRate,
            })
            : null;
    const usage = input.usage;
    const data = {
        userId,
        userEmail: input.userEmail || null,
        userNickname: input.userNickname || null,
        userGroup: input.userGroup || null,
        appId,
        channel,
        providerId: input.providerId || null,
        model,
        generationMode: input.mediaProduct ? 'media' : 'text',
        requestId,
        upstreamRequestId: input.upstreamRequestId || null,
        upstreamTraceId: input.upstreamTraceId || null,
        upstreamUrl: input.upstreamUrl || null,
        status: input.status || 'succeeded',
        errorMessage: input.errorMessage || null,
        inputTokens: toBigInt(usage?.inputTokens),
        cachedInputTokens: toBigInt(usage?.cachedInputTokens),
        outputTokens: toBigInt(usage?.outputTokens),
        reasoningTokens: toBigInt(usage?.reasoningTokens),
        totalTokens: toBigInt(usage?.totalTokens),
        usageSource: input.usageSource || (usage ? 'response' : 'estimated'),
        billingAudience,
        upstreamCostUsd: billing?.upstreamCostUsd ?? null,
        upstreamCostCny: billing?.upstreamCostCny ?? null,
        groupMultiplier: billing?.groupMultiplier ?? input.groupMultiplier ?? null,
        saleMultiplier: billing?.saleMultiplier ?? null,
        costCredits: toBigInt(billing?.costCredits),
        chargedCredits: toBigInt(billing?.chargedCredits),
        billingUnit: billing?.billingUnit ?? null,
        billableUnits: billing?.billableUnits ?? null,
        priceVersion: billing?.priceVersion ?? null,
        completedAt: (input.status || 'succeeded') === 'succeeded' ? new Date() : null,
    };

    for (let attempt = 0; attempt < USAGE_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            return await prisma.$transaction(async (tx) => {
                const existing = await tx.videoUsageLog.findUnique({
                    where: {
                        channel_requestId: {
                            channel,
                            requestId,
                        },
                    },
                    select: {
                        userId: true,
                        chargedCredits: true,
                    },
                });
                if (existing && existing.userId !== userId) {
                    throw new Error('A usage request cannot be reassigned to another user.');
                }

                const saved = await tx.videoUsageLog.upsert({
                    where: {
                        channel_requestId: {
                            channel,
                            requestId,
                        },
                    },
                    create: data,
                    update: data,
                    select: {
                        id: true,
                        requestId: true,
                        totalTokens: true,
                        upstreamCostCny: true,
                        chargedCredits: true,
                        billingAudience: true,
                        priceVersion: true,
                    },
                });

                if (billingAudience === 'internal') {
                    return saved;
                }

                const previousCharge = serializeAiUsageNumber(existing?.chargedCredits);
                const nextCharge = serializeAiUsageNumber(saved.chargedCredits);
                const chargedDelta = nextCharge - previousCharge;
                const reserveReferenceKey = reservationReference(channel, requestId);
                const settleReferenceKey = settlementReference(channel, requestId);
                const reservation = await tx.pointsTransaction.findUnique({
                    where: { referenceKey: reserveReferenceKey },
                    select: {
                        amount: true,
                        userId: true,
                    },
                });
                const settlement = await tx.pointsTransaction.findUnique({
                    where: { referenceKey: settleReferenceKey },
                    select: {
                        id: true,
                        userId: true,
                    },
                });
                if (reservation && reservation.userId !== userId) {
                    throw new AppError(
                        'A credit reservation cannot be settled by another account.',
                        409,
                        'CREDIT_RESERVATION_OWNER_MISMATCH',
                    );
                }
                if (settlement && settlement.userId !== userId) {
                    throw new AppError(
                        'A credit settlement cannot be reassigned to another account.',
                        409,
                        'CREDIT_SETTLEMENT_OWNER_MISMATCH',
                    );
                }

                if (reservation && !settlement) {
                    const reservedAmount = Math.max(0, -reservation.amount);
                    const adjustment = reservedAmount - nextCharge;
                    if (adjustment < 0) {
                        const extraCharge = -adjustment;
                        const charged = await claimSpendableCredits(tx, {
                            userId,
                            amount: extraCharge,
                        });
                        if (!charged) {
                            throw new AppError(
                                'Insufficient credits to settle this request.',
                                402,
                                'INSUFFICIENT_CREDITS',
                            );
                        }
                    } else if (adjustment > 0) {
                        await tx.user.update({
                            where: { id: userId },
                            data: {
                                pointsBalance: { increment: adjustment },
                            },
                        });
                    }

                    const updatedUser = await tx.user.findUniqueOrThrow({
                        where: { id: userId },
                        select: { pointsBalance: true },
                    });
                    await tx.pointsTransaction.create({
                        data: {
                            userId,
                            type: 'settle',
                            amount: adjustment,
                            balanceAfter: updatedUser.pointsBalance,
                            description: `AI 用量结算 · ${appId} / ${model} · 实扣 ${nextCharge} 积分`,
                            referenceKey: settleReferenceKey,
                        },
                    });
                } else if (!reservation && chargedDelta !== 0) {
                    if (chargedDelta > 0) {
                        const charged = await claimSpendableCredits(tx, {
                            userId,
                            amount: chargedDelta,
                        });
                        if (!charged) {
                            throw new AppError(
                                'Insufficient credits.',
                                402,
                                'INSUFFICIENT_CREDITS',
                            );
                        }
                    } else {
                        await tx.user.update({
                            where: { id: userId },
                            data: {
                                pointsBalance: { increment: -chargedDelta },
                            },
                        });
                    }

                    const updatedUser = await tx.user.findUniqueOrThrow({
                        where: { id: userId },
                        select: { pointsBalance: true },
                    });
                    await tx.pointsTransaction.create({
                        data: {
                            userId,
                            type: chargedDelta > 0 ? 'consume' : 'refund',
                            amount: -chargedDelta,
                            balanceAfter: updatedUser.pointsBalance,
                            description: `AI 用量扣费 · ${appId} / ${model}`,
                        },
                    });
                }

                return saved;
            }, USAGE_TRANSACTION_OPTIONS);
        } catch (error) {
            if (!isRetryableTransactionError(error)) {
                throw error;
            }
            if (attempt >= USAGE_TRANSACTION_ATTEMPTS - 1) {
                break;
            }
            await waitForTransactionRetry(attempt);
        }
    }

    throw new Error('Unable to record AI usage after transaction retries.');
}

export function serializeAiUsageNumber(value: unknown): number {
    if (typeof value === 'bigint') return Number(value);
    if (value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
        return value.toNumber();
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
