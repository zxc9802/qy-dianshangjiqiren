import assert from 'node:assert/strict';
import test from 'node:test';

import {
    calculateFixedMediaBilling,
    calculateTextUsageBilling,
    parseGeminiUsageMetadata,
    parseOpenAICompatibleUsage,
} from '../app/lib/ai-usage.ts';

test('parses OpenAI-compatible cached and reasoning token details', () => {
    assert.deepEqual(parseOpenAICompatibleUsage({
        usage: {
            prompt_tokens: 1652,
            completion_tokens: 785,
            total_tokens: 2437,
            prompt_tokens_details: { cached_tokens: 1280 },
            completion_tokens_details: { reasoning_tokens: 66 },
        },
    }), {
        inputTokens: 1652,
        cachedInputTokens: 1280,
        outputTokens: 785,
        reasoningTokens: 66,
        totalTokens: 2437,
    });
});

test('parses Gemini usage metadata including thought tokens', () => {
    assert.deepEqual(parseGeminiUsageMetadata({
        usageMetadata: {
            promptTokenCount: 72,
            candidatesTokenCount: 201,
            thoughtsTokenCount: 995,
            totalTokenCount: 1268,
        },
    }), {
        inputTokens: 72,
        cachedInputTokens: 0,
        outputTokens: 1196,
        reasoningTokens: 995,
        totalTokens: 1268,
    });
});

test('external GPT-5.4 usage is billed at 1.8 times cost', () => {
    const billing = calculateTextUsageBilling({
        model: 'gpt-5.4',
        usage: {
            inputTokens: 212,
            cachedInputTokens: 0,
            outputTokens: 1346,
            reasoningTokens: 0,
            totalTokens: 1558,
        },
        billingAudience: 'external',
    });

    assert.equal(billing?.costCredits, 16);
    assert.equal(billing?.chargedCredits, 28);
    assert.equal(billing?.saleMultiplier, 1.8);
});

test('internal usage records cost but does not charge external credits', () => {
    const billing = calculateTextUsageBilling({
        model: 'gpt-5.4',
        usage: {
            inputTokens: 212,
            cachedInputTokens: 0,
            outputTokens: 1346,
            reasoningTokens: 0,
            totalTokens: 1558,
        },
        billingAudience: 'internal',
    });

    assert.equal(billing?.costCredits, 16);
    assert.equal(billing?.chargedCredits, 0);
});

test('SSO child-tool text models have server-side billing prices', () => {
    const models = [
        'deepseek-chat',
        'deepseek-v4-flash',
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-5.6-luna',
        'gemini-3.1-flash-lite',
        'gemini-3.5-flash-lite',
    ];
    for (const model of models) {
        const billing = calculateTextUsageBilling({
            model,
            usage: {
                inputTokens: 1_000,
                cachedInputTokens: 0,
                outputTokens: 1_000,
                reasoningTokens: 0,
                totalTokens: 2_000,
            },
            billingAudience: 'external',
        });
        assert.ok(billing, `${model} should have a billing price`);
        assert.ok(billing.chargedCredits > 0, `${model} should consume external credits`);
    }
});

test('fixed media prices match the confirmed external 1.8 multiplier', () => {
    assert.equal(calculateFixedMediaBilling({
        product: 'seedance2',
        units: 1,
        billingAudience: 'external',
    }).chargedCredits, 180);
    assert.equal(calculateFixedMediaBilling({
        product: 'seedance2-fast',
        units: 1,
        billingAudience: 'external',
    }).chargedCredits, 90);
    assert.equal(calculateFixedMediaBilling({
        product: 'nanobanana2',
        units: 3,
        billingAudience: 'external',
    }).chargedCredits, 108);
});
