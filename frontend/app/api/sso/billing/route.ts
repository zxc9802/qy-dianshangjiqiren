import { z } from 'zod';
import { NextRequest } from 'next/server';
import { errorResponse, getAuthUser, AppError } from '@/app/lib/auth';
import {
    recordAiUsageEvent,
    releaseAiUsageCredits,
    reserveAiUsageCredits,
} from '@/app/lib/ai-usage-store';
import {
    calculateFixedMediaBilling,
    calculateTextUsageBilling,
} from '@/app/lib/ai-usage';
import {
    getExternalSsoClientSecretHeaderName,
    isValidExternalSsoClientSecret,
    parseExternalSsoProduct,
} from '@/app/lib/external-sso';
import { prisma } from '@/app/lib/prisma';
import { enforceRateLimit } from '@/app/lib/security-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const usageSchema = z.object({
    inputTokens: z.number().int().nonnegative().max(100_000_000),
    cachedInputTokens: z.number().int().nonnegative().max(100_000_000).default(0),
    outputTokens: z.number().int().nonnegative().max(100_000_000),
    reasoningTokens: z.number().int().nonnegative().max(100_000_000).default(0),
    totalTokens: z.number().int().nonnegative().max(200_000_000),
}).superRefine((usage, context) => {
    if (usage.cachedInputTokens > usage.inputTokens) {
        context.addIssue({
            code: 'custom',
            path: ['cachedInputTokens'],
            message: 'cachedInputTokens cannot exceed inputTokens.',
        });
    }
    if (usage.reasoningTokens > usage.outputTokens) {
        context.addIssue({
            code: 'custom',
            path: ['reasoningTokens'],
            message: 'reasoningTokens cannot exceed outputTokens.',
        });
    }
    if (usage.totalTokens < usage.inputTokens + usage.outputTokens) {
        context.addIssue({
            code: 'custom',
            path: ['totalTokens'],
            message: 'totalTokens cannot be lower than inputTokens plus outputTokens.',
        });
    }
});

const billingSchema = z.object({
    action: z.enum(['reserve', 'settle', 'release']),
    product: z.string().trim().min(1).max(50),
    userId: z.string().trim().min(1).max(191),
    requestId: z.string().uuid(),
    operation: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    model: z.string().trim().min(1).max(191).optional(),
    providerId: z.string().trim().max(100).optional(),
    estimatedInputTokens: z.number().int().nonnegative().max(100_000_000).optional(),
    maxOutputTokens: z.number().int().positive().max(10_000_000).optional(),
    usage: usageSchema.optional(),
    mediaProduct: z.enum(['seedance2', 'seedance2-fast', 'nanobanana2']).optional(),
    billableUnits: z.number().positive().max(1_000_000).optional(),
}).superRefine((value, context) => {
    if (value.action === 'release') return;
    if (value.mediaProduct) {
        if (!value.billableUnits) {
            context.addIssue({
                code: 'custom',
                path: ['billableUnits'],
                message: 'billableUnits is required for media billing.',
            });
        }
        return;
    }
    if (!value.model) {
        context.addIssue({
            code: 'custom',
            path: ['model'],
            message: 'model is required for text billing.',
        });
    }
    if (value.action === 'reserve' && (
        value.estimatedInputTokens === undefined
        || value.maxOutputTokens === undefined
    )) {
        context.addIssue({
            code: 'custom',
            message: 'estimatedInputTokens and maxOutputTokens are required to reserve text credits.',
        });
    }
    if (value.action === 'settle' && !value.usage) {
        context.addIssue({
            code: 'custom',
            path: ['usage'],
            message: 'usage is required to settle text credits.',
        });
    }
});

function serializeSavedUsage(saved: Awaited<ReturnType<typeof recordAiUsageEvent>>) {
    return {
        ...saved,
        totalTokens: Number(saved.totalTokens || 0),
        upstreamCostCny: Number(saved.upstreamCostCny || 0),
        chargedCredits: Number(saved.chargedCredits || 0),
    };
}

async function getBillingUser(req: NextRequest, userId: string) {
    if (req.headers.get('authorization')) {
        const authenticated = await getAuthUser(req);
        if (authenticated.id !== userId) {
            throw new AppError(
                'The SSO billing account does not match the signed-in account.',
                403,
                'SSO_BILLING_ACCOUNT_MISMATCH',
            );
        }
        return authenticated;
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            nickname: true,
            groupName: true,
            billingAudience: true,
            accountStatus: true,
            role: true,
            accessGrantedAt: true,
            pointsBalance: true,
        },
    });
    if (!user) {
        throw new AppError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');
    }
    if (user.accountStatus !== 'active') {
        throw new AppError('This account has been suspended.', 403, 'ACCOUNT_SUSPENDED');
    }
    if (user.role !== 'admin' && !user.accessGrantedAt) {
        throw new AppError('Invite code required.', 403, 'INVITE_REQUIRED');
    }
    return user;
}

export async function POST(req: NextRequest) {
    try {
        const input = billingSchema.parse(await req.json());
        const product = parseExternalSsoProduct(input.product);
        const clientSecret = req.headers.get(getExternalSsoClientSecretHeaderName());
        if (!isValidExternalSsoClientSecret(product, clientSecret)) {
            throw new AppError('Unauthorized SSO billing client.', 401, 'SSO_BILLING_CLIENT_UNAUTHORIZED');
        }

        const user = await getBillingUser(req, input.userId);
        await enforceRateLimit({
            scope: `sso-billing:${product}`,
            identifier: user.id,
            limit: 600,
            windowMs: 60_000,
            blockMs: 60_000,
        });

        const channel = `sso:${product}:${input.operation}`;
        if (input.action === 'release') {
            await releaseAiUsageCredits({
                userId: user.id,
                channel,
                requestId: input.requestId,
            });
        } else if (input.action === 'reserve') {
            const billing = input.mediaProduct
                ? calculateFixedMediaBilling({
                    product: input.mediaProduct,
                    units: input.billableUnits || 0,
                    billingAudience: user.billingAudience === 'internal' ? 'internal' : 'external',
                })
                : calculateTextUsageBilling({
                    model: input.model || '',
                    usage: {
                        inputTokens: input.estimatedInputTokens || 0,
                        cachedInputTokens: 0,
                        outputTokens: input.maxOutputTokens || 0,
                        reasoningTokens: 0,
                        totalTokens: (input.estimatedInputTokens || 0) + (input.maxOutputTokens || 0),
                    },
                    billingAudience: user.billingAudience === 'internal' ? 'internal' : 'external',
                });
            if (!billing) {
                throw new AppError(
                    'This model is not available for external credit billing.',
                    403,
                    'MODEL_NOT_AVAILABLE_FOR_EXTERNAL_BILLING',
                );
            }
            const reservedCredits = await reserveAiUsageCredits({
                userId: user.id,
                channel,
                requestId: input.requestId,
                amount: billing.chargedCredits,
                description: `SSO AI 请求预留 · ${product} / ${input.model || input.mediaProduct}`,
            });
            const balance = await prisma.user.findUniqueOrThrow({
                where: { id: user.id },
                select: { pointsBalance: true },
            });
            return Response.json({
                success: true,
                data: {
                    action: input.action,
                    requestId: input.requestId,
                    reservedCredits,
                    pointsBalance: balance.pointsBalance,
                    chargeRequired: user.billingAudience === 'external',
                },
            });
        } else {
            const saved = await recordAiUsageEvent({
                userId: user.id,
                userEmail: user.email,
                userNickname: user.nickname,
                userGroup: user.groupName,
                appId: `sso-${product}`,
                channel,
                providerId: input.providerId,
                model: input.model || input.mediaProduct || 'unknown',
                requestId: input.requestId,
                usage: input.usage,
                usageSource: 'response',
                mediaProduct: input.mediaProduct,
                billableUnits: input.billableUnits,
            });
            const balance = await prisma.user.findUniqueOrThrow({
                where: { id: user.id },
                select: { pointsBalance: true },
            });
            return Response.json({
                success: true,
                data: {
                    action: input.action,
                    requestId: input.requestId,
                    usage: serializeSavedUsage(saved),
                    pointsBalance: balance.pointsBalance,
                    chargeRequired: user.billingAudience === 'external',
                },
            });
        }

        const balance = await prisma.user.findUniqueOrThrow({
            where: { id: user.id },
            select: { pointsBalance: true },
        });
        return Response.json({
            success: true,
            data: {
                action: input.action,
                requestId: input.requestId,
                pointsBalance: balance.pointsBalance,
                chargeRequired: user.billingAudience === 'external',
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}
