import {
    calculateFixedMediaBilling,
    calculateTextUsageBilling,
    normalizeBillingAudience,
    type AiTokenUsage,
    type BillingAudience,
} from './ai-usage';
import { prisma } from './prisma';

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

function toBigInt(value: number | undefined | null): bigint | null {
    if (!Number.isFinite(value) || Number(value) < 0) return null;
    return BigInt(Math.trunc(Number(value)));
}

export async function recordAiUsageEvent(input: RecordAiUsageEventInput) {
    const userId = input.userId.trim();
    const appId = input.appId.trim();
    const channel = input.channel.trim();
    const model = input.model.trim();
    const requestId = input.requestId.trim();
    if (!userId || !appId || !channel || !model || !requestId) {
        throw new Error('userId, appId, channel, model and requestId are required');
    }

    const billingAudience = normalizeBillingAudience(input.billingAudience);
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

    return prisma.videoUsageLog.upsert({
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
}

export function serializeAiUsageNumber(value: unknown): number {
    if (typeof value === 'bigint') return Number(value);
    if (value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
        return value.toNumber();
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
