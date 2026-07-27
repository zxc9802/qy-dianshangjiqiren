export const CREDITS_PER_CNY = 100;
export const EXTERNAL_SALE_MULTIPLIER = 1.8;
export const INTERNAL_SALE_MULTIPLIER = 1;
export const DEFAULT_USD_CNY_RATE = 7.3;
export const AI_USAGE_PRICE_VERSION = '2026-07-27';

export type BillingAudience = 'internal' | 'external';

export function isExternallyBilledAccount(account: {
    billingAudience: string;
    role: string;
}): boolean {
    return account.billingAudience === 'external' && account.role !== 'admin';
}

export type AiTokenUsage = {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
};

export type AiUsageBilling = {
    priceVersion: string;
    billingAudience: BillingAudience;
    billingUnit: 'token' | 'second' | 'image';
    billableUnits: number;
    groupMultiplier: number;
    saleMultiplier: number;
    upstreamCostUsd: number | null;
    upstreamCostCny: number;
    costCredits: number;
    chargedCredits: number;
};

type TextModelPrice = {
    inputUsdPerMillion: number;
    cachedInputUsdPerMillion: number;
    outputUsdPerMillion: number;
};

const TEXT_MODEL_PRICES: Record<string, TextModelPrice> = {
    'deepseek-chat': {
        inputUsdPerMillion: 0.28,
        cachedInputUsdPerMillion: 0.028,
        outputUsdPerMillion: 0.42,
    },
    'deepseek-v4-flash': {
        inputUsdPerMillion: 0.28,
        cachedInputUsdPerMillion: 0.028,
        outputUsdPerMillion: 0.42,
    },
    'gpt-4.1': {
        inputUsdPerMillion: 2,
        cachedInputUsdPerMillion: 0.5,
        outputUsdPerMillion: 8,
    },
    'gpt-4.1-mini': {
        inputUsdPerMillion: 0.4,
        cachedInputUsdPerMillion: 0.1,
        outputUsdPerMillion: 1.6,
    },
    'gpt-5.4': {
        inputUsdPerMillion: 2.5,
        cachedInputUsdPerMillion: 0.25,
        outputUsdPerMillion: 15,
    },
    'gpt-5.6-luna': {
        inputUsdPerMillion: 1,
        cachedInputUsdPerMillion: 0.1,
        outputUsdPerMillion: 6,
    },
    'gemini-3.1-pro-preview': {
        inputUsdPerMillion: 2,
        cachedInputUsdPerMillion: 0.2,
        outputUsdPerMillion: 12,
    },
    'gemini-3.1-flash-lite': {
        inputUsdPerMillion: 0.1,
        cachedInputUsdPerMillion: 0.01,
        outputUsdPerMillion: 0.4,
    },
    'gemini-3.5-flash-lite': {
        inputUsdPerMillion: 0.1,
        cachedInputUsdPerMillion: 0.01,
        outputUsdPerMillion: 0.4,
    },
    'claude-opus-4-6': {
        inputUsdPerMillion: 5,
        cachedInputUsdPerMillion: 0.5,
        outputUsdPerMillion: 25,
    },
};

const FIXED_MEDIA_COSTS_CNY = {
    seedance2: { billingUnit: 'second' as const, costCnyPerUnit: 1 },
    'seedance2-fast': { billingUnit: 'second' as const, costCnyPerUnit: 0.5 },
    nanobanana2: { billingUnit: 'image' as const, costCnyPerUnit: 0.2 },
};

function finiteNonnegative(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function readObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function ceilCredits(value: number): number {
    return Math.ceil(Number(value.toFixed(8)));
}

export function normalizeBillingAudience(value: unknown): BillingAudience {
    return value === 'internal' ? 'internal' : 'external';
}

export function parseOpenAICompatibleUsage(payload: unknown): AiTokenUsage | null {
    const root = readObject(payload);
    const usage = readObject(root?.usage);
    if (!usage) return null;

    const promptDetails = readObject(usage.prompt_tokens_details) || readObject(usage.input_tokens_details);
    const completionDetails = readObject(usage.completion_tokens_details) || readObject(usage.output_tokens_details);
    const inputTokens = finiteNonnegative(usage.prompt_tokens ?? usage.input_tokens);
    const cachedInputTokens = Math.min(
        inputTokens,
        finiteNonnegative(
            promptDetails?.cached_tokens
            ?? usage.cache_read_input_tokens
            ?? usage.cached_input_tokens,
        ),
    );
    const outputTokens = finiteNonnegative(usage.completion_tokens ?? usage.output_tokens);
    const reasoningTokens = Math.min(
        outputTokens,
        finiteNonnegative(
            completionDetails?.reasoning_tokens
            ?? usage.reasoning_tokens,
        ),
    );
    const totalTokens = finiteNonnegative(usage.total_tokens) || inputTokens + outputTokens;

    if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) return null;

    return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningTokens,
        totalTokens,
    };
}

export function parseGeminiUsageMetadata(payload: unknown): AiTokenUsage | null {
    const root = readObject(payload);
    const usage = readObject(root?.usageMetadata);
    if (!usage) return null;

    const inputTokens = finiteNonnegative(usage.promptTokenCount);
    const cachedInputTokens = Math.min(inputTokens, finiteNonnegative(usage.cachedContentTokenCount));
    const outputTokens = finiteNonnegative(usage.candidatesTokenCount) + finiteNonnegative(usage.thoughtsTokenCount);
    const reasoningTokens = Math.min(outputTokens, finiteNonnegative(usage.thoughtsTokenCount));
    const totalTokens = finiteNonnegative(usage.totalTokenCount) || inputTokens + outputTokens;

    if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) return null;

    return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningTokens,
        totalTokens,
    };
}

function resolveSaleMultiplier(audience: BillingAudience): number {
    return audience === 'external' ? EXTERNAL_SALE_MULTIPLIER : INTERNAL_SALE_MULTIPLIER;
}

export function calculateTextUsageBilling(input: {
    model: string;
    usage: AiTokenUsage;
    billingAudience?: BillingAudience;
    groupMultiplier?: number;
    usdCnyRate?: number;
}): AiUsageBilling | null {
    const price = TEXT_MODEL_PRICES[input.model.trim().toLowerCase()];
    if (!price) return null;

    const billingAudience = normalizeBillingAudience(input.billingAudience);
    const groupMultiplier = Number.isFinite(input.groupMultiplier) && Number(input.groupMultiplier) > 0
        ? Number(input.groupMultiplier)
        : 1;
    const usdCnyRate = Number.isFinite(input.usdCnyRate) && Number(input.usdCnyRate) > 0
        ? Number(input.usdCnyRate)
        : DEFAULT_USD_CNY_RATE;
    const noncachedInputTokens = Math.max(0, input.usage.inputTokens - input.usage.cachedInputTokens);
    const baseCostUsd = (
        noncachedInputTokens * price.inputUsdPerMillion
        + input.usage.cachedInputTokens * price.cachedInputUsdPerMillion
        + input.usage.outputTokens * price.outputUsdPerMillion
    ) / 1_000_000;
    const upstreamCostUsd = baseCostUsd * groupMultiplier;
    const upstreamCostCny = upstreamCostUsd * usdCnyRate;
    const saleMultiplier = resolveSaleMultiplier(billingAudience);

    return {
        priceVersion: AI_USAGE_PRICE_VERSION,
        billingAudience,
        billingUnit: 'token',
        billableUnits: input.usage.totalTokens,
        groupMultiplier,
        saleMultiplier,
        upstreamCostUsd,
        upstreamCostCny,
        costCredits: ceilCredits(upstreamCostCny * CREDITS_PER_CNY),
        chargedCredits: billingAudience === 'external'
            ? ceilCredits(upstreamCostCny * CREDITS_PER_CNY * saleMultiplier)
            : 0,
    };
}

export function estimateTextUsageReservationCredits(input: {
    model: string;
    promptText: string;
    maxOutputTokens: number;
    billingAudience?: BillingAudience;
    groupMultiplier?: number;
    usdCnyRate?: number;
}): number {
    const inputTokenUpperBound = new TextEncoder().encode(input.promptText).length;
    const outputTokenUpperBound = Math.max(1, Math.trunc(input.maxOutputTokens));
    const billing = calculateTextUsageBilling({
        model: input.model,
        usage: {
            inputTokens: inputTokenUpperBound,
            cachedInputTokens: 0,
            outputTokens: outputTokenUpperBound,
            reasoningTokens: 0,
            totalTokens: inputTokenUpperBound + outputTokenUpperBound,
        },
        billingAudience: input.billingAudience,
        groupMultiplier: input.groupMultiplier,
        usdCnyRate: input.usdCnyRate,
    });

    return billing?.chargedCredits || 0;
}

export function calculateFixedMediaBilling(input: {
    product: keyof typeof FIXED_MEDIA_COSTS_CNY;
    units: number;
    billingAudience?: BillingAudience;
}): AiUsageBilling {
    const price = FIXED_MEDIA_COSTS_CNY[input.product];
    const units = Number.isFinite(input.units) && input.units > 0 ? input.units : 0;
    const billingAudience = normalizeBillingAudience(input.billingAudience);
    const saleMultiplier = resolveSaleMultiplier(billingAudience);
    const upstreamCostCny = price.costCnyPerUnit * units;

    return {
        priceVersion: AI_USAGE_PRICE_VERSION,
        billingAudience,
        billingUnit: price.billingUnit,
        billableUnits: units,
        groupMultiplier: 1,
        saleMultiplier,
        upstreamCostUsd: null,
        upstreamCostCny,
        costCredits: ceilCredits(upstreamCostCny * CREDITS_PER_CNY),
        chargedCredits: billingAudience === 'external'
            ? ceilCredits(upstreamCostCny * CREDITS_PER_CNY * saleMultiplier)
            : 0,
    };
}
