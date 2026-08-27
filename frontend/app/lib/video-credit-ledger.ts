import { Prisma } from '@prisma/client';
import { AppError } from './auth';
import { prisma } from './prisma';
import type { VideoCreditLedger } from './video-credit-service';
import {
    legacyVideoCreditReservationReference,
    planVideoCreditTransition,
    readActiveVideoHeldPoints,
    videoCreditReservationReference,
} from './video-credit-reservation-state';

const TRANSACTION_OPTIONS = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 20_000,
} as const;
const TRANSACTION_ATTEMPTS = 3;

let schemaPromise: Promise<void> | null = null;

type StoredVideoReservation = {
    id: string;
    userId: string;
    type: string;
    amount: number;
};

function refundReference(requestId: string): string {
    return `video-sso:refund:${requestId}`;
}

async function findVideoReservation(
    tx: Prisma.TransactionClient,
    requestId: string,
): Promise<{ reservation: StoredVideoReservation; legacyPreDeducted: boolean } | null> {
    const select = { id: true, userId: true, type: true, amount: true } as const;
    const reservation = await tx.pointsTransaction.findUnique({
        where: { referenceKey: videoCreditReservationReference(requestId) },
        select,
    });
    if (reservation) return { reservation, legacyPreDeducted: false };

    const legacyReservation = await tx.pointsTransaction.findUnique({
        where: { referenceKey: legacyVideoCreditReservationReference(requestId) },
        select,
    });
    return legacyReservation
        ? { reservation: legacyReservation, legacyPreDeducted: true }
        : null;
}

async function ensureVideoCreditLedgerSchema(): Promise<void> {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await prisma.$executeRawUnsafe(`
                ALTER TABLE points_transactions
                ADD COLUMN IF NOT EXISTS reference_key TEXT
            `);
            await prisma.$executeRawUnsafe(`
                CREATE UNIQUE INDEX IF NOT EXISTS points_transactions_reference_key_key
                ON points_transactions(reference_key)
                WHERE reference_key IS NOT NULL
            `);
            await prisma.$executeRawUnsafe(`
                CREATE INDEX IF NOT EXISTS points_transactions_user_id_created_at_idx
                ON points_transactions(user_id, created_at DESC)
            `);
        })().catch((error) => {
            schemaPromise = null;
            throw error;
        });
    }
    await schemaPromise;
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            const retryable = (
                error instanceof Prisma.PrismaClientKnownRequestError
                && (error.code === 'P2002' || error.code === 'P2034')
                && attempt < TRANSACTION_ATTEMPTS - 1
            );
            if (!retryable) throw error;
        }
    }
    throw new AppError('Video credit ledger is temporarily unavailable.', 503, 'VIDEO_CREDIT_LEDGER_UNAVAILABLE');
}

async function readBalance(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const user = await tx.user.findUnique({
        where: { id: userId },
        select: { pointsBalance: true },
    });
    if (!user) throw new AppError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');
    return user.pointsBalance;
}

export const prismaVideoCreditLedger: VideoCreditLedger = {
    async reserve(input) {
        await ensureVideoCreditLedgerSchema();
        return withRetry(() => prisma.$transaction(async (tx) => {
            const existing = await findVideoReservation(tx, input.requestId);
            if (existing) {
                if (existing.reservation.userId !== input.userId) {
                    throw new AppError('Video credit reservation belongs to another account.', 409, 'VIDEO_CREDIT_OWNER_MISMATCH');
                }
                return { pointsBalance: await readBalance(tx, input.userId) };
            }

            const account = await tx.user.findUnique({
                where: { id: input.userId },
                select: { groupName: true, pointsBalance: true },
            });
            if (!account) {
                throw new AppError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');
            }
            const heldPoints = await readActiveVideoHeldPoints(tx, input.userId);
            const transition = planVideoCreditTransition({
                action: 'reserve',
                pointsBalance: account.pointsBalance,
                heldPoints,
                amount: input.amount,
            });
            if (account.groupName !== '外部用户' || !transition.allowed) {
                throw new AppError(
                    `积分不足，本次生成需要 ${input.amount} 积分。`,
                    402,
                    'INSUFFICIENT_CREDITS',
                );
            }

            await tx.pointsTransaction.create({
                data: {
                    userId: input.userId,
                    type: 'reserve',
                    amount: -input.amount,
                    balanceAfter: transition.pointsBalance,
                    description: input.description,
                    referenceKey: videoCreditReservationReference(input.requestId),
                },
            });
            return { pointsBalance: transition.pointsBalance };
        }, TRANSACTION_OPTIONS));
    },

    async settle(input) {
        await ensureVideoCreditLedgerSchema();
        return withRetry(() => prisma.$transaction(async (tx) => {
            const stored = await findVideoReservation(tx, input.requestId);
            if (!stored) {
                throw new AppError('Video credit reservation was not found.', 409, 'VIDEO_CREDIT_RESERVATION_NOT_FOUND');
            }
            const { reservation, legacyPreDeducted } = stored;
            if (reservation.userId !== input.userId) {
                throw new AppError('Video credit reservation belongs to another account.', 409, 'VIDEO_CREDIT_OWNER_MISMATCH');
            }
            const chargedPoints = Math.max(0, -reservation.amount);
            let pointsBalance = await readBalance(tx, input.userId);
            if (reservation.type === 'reserve') {
                if (!legacyPreDeducted) {
                    const heldPoints = await readActiveVideoHeldPoints(tx, input.userId);
                    const transition = planVideoCreditTransition({
                        action: 'settle',
                        pointsBalance,
                        heldPoints,
                        amount: chargedPoints,
                    });
                    if (!transition.allowed) {
                        throw new AppError(
                            `积分不足，本次生成需要 ${chargedPoints} 积分。`,
                            402,
                            'INSUFFICIENT_CREDITS',
                        );
                    }
                    const claimed = await tx.user.updateMany({
                        where: {
                            id: input.userId,
                            groupName: '外部用户',
                            pointsBalance: { gte: chargedPoints },
                        },
                        data: { pointsBalance: { decrement: chargedPoints } },
                    });
                    if (claimed.count !== 1) {
                        throw new AppError(
                            `积分不足，本次生成需要 ${chargedPoints} 积分。`,
                            402,
                            'INSUFFICIENT_CREDITS',
                        );
                    }
                    pointsBalance = await readBalance(tx, input.userId);
                }
                await tx.pointsTransaction.update({
                    where: { id: reservation.id },
                    data: {
                        type: 'consume',
                        balanceAfter: pointsBalance,
                        description: `Seedance 视频生成扣费 · 实扣 ${chargedPoints} 积分`,
                    },
                });
            } else if (reservation.type !== 'consume') {
                throw new AppError('Released video credits cannot be settled.', 409, 'VIDEO_CREDIT_ALREADY_RELEASED');
            }
            return {
                pointsBalance,
                chargedPoints,
            };
        }, TRANSACTION_OPTIONS));
    },

    async release(input) {
        await ensureVideoCreditLedgerSchema();
        return withRetry(() => prisma.$transaction(async (tx) => {
            const stored = await findVideoReservation(tx, input.requestId);
            if (!stored) {
                return {
                    pointsBalance: await readBalance(tx, input.userId),
                    releasedPoints: 0,
                };
            }
            const { reservation, legacyPreDeducted } = stored;
            if (reservation.userId !== input.userId) {
                throw new AppError('Video credit reservation belongs to another account.', 409, 'VIDEO_CREDIT_OWNER_MISMATCH');
            }
            const releasedPoints = Math.max(0, -reservation.amount);
            if (reservation.type === 'consume') {
                return {
                    pointsBalance: await readBalance(tx, input.userId),
                    releasedPoints: 0,
                };
            }
            if (reservation.type === 'reserve') {
                if (legacyPreDeducted) {
                    const updatedUser = await tx.user.update({
                        where: { id: input.userId },
                        data: { pointsBalance: { increment: releasedPoints } },
                        select: { pointsBalance: true },
                    });
                    await tx.pointsTransaction.update({
                        where: { id: reservation.id },
                        data: {
                            type: 'released',
                            balanceAfter: updatedUser.pointsBalance,
                        },
                    });
                    await tx.pointsTransaction.create({
                        data: {
                            userId: input.userId,
                            type: 'refund',
                            amount: releasedPoints,
                            balanceAfter: updatedUser.pointsBalance,
                            description: 'Seedance 视频生成未成功，已退回旧版预扣积分',
                            referenceKey: refundReference(input.requestId),
                        },
                    });
                    return {
                        pointsBalance: updatedUser.pointsBalance,
                        releasedPoints,
                    };
                }
                const pointsBalance = await readBalance(tx, input.userId);
                const heldPoints = await readActiveVideoHeldPoints(tx, input.userId);
                const transition = planVideoCreditTransition({
                    action: 'release',
                    pointsBalance,
                    heldPoints,
                    amount: releasedPoints,
                });
                if (!transition.allowed) {
                    throw new AppError(
                        'Video credit reservation could not be released.',
                        409,
                        'VIDEO_CREDIT_RESERVATION_STATE_INVALID',
                    );
                }
                await tx.pointsTransaction.update({
                    where: { id: reservation.id },
                    data: {
                        type: 'released',
                        balanceAfter: transition.pointsBalance,
                        description: 'Seedance 视频生成未成功，已释放预留积分',
                    },
                });
                return {
                    pointsBalance: transition.pointsBalance,
                    releasedPoints,
                };
            }
            return {
                pointsBalance: await readBalance(tx, input.userId),
                releasedPoints,
            };
        }, TRANSACTION_OPTIONS));
    },
};
