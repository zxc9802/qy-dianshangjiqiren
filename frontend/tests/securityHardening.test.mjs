import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    calculateTextUsageBilling,
    estimateTextUsageReservationCredits,
    isExternallyBilledAccount,
} from '../app/lib/ai-usage.ts';
import {
    hashRechargeCode,
    normalizeRechargeCode,
} from '../app/lib/recharge-codes.ts';
import { resolveRateLimitAttempt } from '../app/lib/security-rate-limit-core.ts';
import { isRetryableTransactionError } from '../app/lib/transaction-retry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, '..');

test('text credit reservation is an upper bound for the final metered charge', () => {
    const reservation = estimateTextUsageReservationCredits({
        model: 'gpt-5.4',
        promptText: '请帮我生成一份电商运营计划'.repeat(20),
        maxOutputTokens: 8192,
        billingAudience: 'external',
    });
    const actual = calculateTextUsageBilling({
        model: 'gpt-5.4',
        usage: {
            inputTokens: 300,
            cachedInputTokens: 0,
            outputTokens: 1200,
            reasoningTokens: 0,
            totalTokens: 1500,
        },
        billingAudience: 'external',
    });

    assert.ok(reservation > 0);
    assert.ok(actual);
    assert.ok(reservation >= actual.chargedCredits);
});

test('rate limiting blocks the first request above the configured limit', () => {
    const now = new Date('2026-07-27T00:00:00.000Z');
    const options = { limit: 3, windowMs: 60_000, blockMs: 300_000 };
    const first = resolveRateLimitAttempt(null, now, options);
    const second = resolveRateLimitAttempt(first.state, now, options);
    const third = resolveRateLimitAttempt(second.state, now, options);
    const fourth = resolveRateLimitAttempt(third.state, now, options);

    assert.equal(first.allowed, true);
    assert.equal(third.allowed, true);
    assert.equal(fourth.allowed, false);
    assert.ok(fourth.retryAfterSeconds > 0);
});

test('only external non-admin accounts use credit billing and usage rate limits', () => {
    assert.equal(isExternallyBilledAccount({ billingAudience: 'external', role: 'user' }), true);
    assert.equal(isExternallyBilledAccount({ billingAudience: 'internal', role: 'user' }), false);
    assert.equal(isExternallyBilledAccount({ billingAudience: 'internal', role: 'admin' }), false);
    assert.equal(isExternallyBilledAccount({ billingAudience: 'external', role: 'admin' }), false);
});

test('authentication checks IP and account rate limits sequentially', async () => {
    const source = await readFile(path.join(frontendRoot, 'app', 'api', 'auth', 'route.ts'), 'utf8');

    assert.match(
        source,
        /await enforceRateLimit\(\{\s*scope: `auth:\$\{action\}:ip`[\s\S]*if \(account\) \{\s*await enforceRateLimit\(\{\s*scope: `auth:\$\{action\}:account`/,
    );
    assert.doesNotMatch(source, /Promise\.all\(checks\)/);
});

test('driver adapter transaction write conflicts are retryable', () => {
    const error = Object.assign(new Error('TransactionWriteConflict'), {
        name: 'DriverAdapterError',
        cause: {
            kind: 'TransactionWriteConflict',
            originalCode: '40001',
        },
    });

    assert.equal(isRetryableTransactionError(error), true);
    assert.equal(isRetryableTransactionError({ code: 'P2034' }), true);
    assert.equal(isRetryableTransactionError(new Error('unrelated')), false);
});

test('chat rate limits and transaction queries run sequentially', async () => {
    const chatSource = await readFile(path.join(frontendRoot, 'app', 'api', 'chat', 'route.ts'), 'utf8');
    const conversationSource = await readFile(
        path.join(frontendRoot, 'app', 'api', 'conversations', '[id]', 'messages', 'route.ts'),
        'utf8',
    );
    const pointsSource = await readFile(path.join(frontendRoot, 'app', 'api', 'points', 'route.ts'), 'utf8');
    const usageSource = await readFile(path.join(frontendRoot, 'app', 'lib', 'ai-usage-store.ts'), 'utf8');

    for (const source of [chatSource, conversationSource, pointsSource]) {
        assert.doesNotMatch(source, /await Promise\.all\(\[\s*enforceRateLimit\(/);
    }
    assert.doesNotMatch(usageSource, /const \[reservation, settlement\] = await Promise\.all\(/);
});

test('internal and admin requests bypass usage rate limits and credit-ledger queries', async () => {
    const chatSource = await readFile(path.join(frontendRoot, 'app', 'api', 'chat', 'route.ts'), 'utf8');
    const conversationSource = await readFile(
        path.join(frontendRoot, 'app', 'api', 'conversations', '[id]', 'messages', 'route.ts'),
        'utf8',
    );
    const reportSource = await readFile(path.join(frontendRoot, 'app', 'api', 'report', 'route.ts'), 'utf8');
    const ssoBillingSource = await readFile(path.join(frontendRoot, 'app', 'api', 'sso', 'billing', 'route.ts'), 'utf8');
    const usageSource = await readFile(path.join(frontendRoot, 'app', 'lib', 'ai-usage-store.ts'), 'utf8');

    for (const source of [chatSource, conversationSource, reportSource, ssoBillingSource]) {
        assert.match(
            source,
            /const isExternallyBilled = isExternallyBilledAccount\([^)]+\);[\s\S]{0,1200}if \(isExternallyBilled\) \{[\s\S]{0,600}await enforceRateLimit\(/,
        );
    }
    assert.match(ssoBillingSource, /if \(isExternallyBilled\) \{[\s\S]{0,1800}reserveAiUsageCredits\(/);
    assert.match(usageSource, /if \(billingAudience === 'internal'\) \{\s*return saved;\s*\}/);
});

test('new recharge codes can be looked up without storing their plaintext value', () => {
    const normalized = normalizeRechargeCode(' jf-abcd-2345-efgh-6789 ');
    const first = hashRechargeCode(normalized, 'test-pepper');
    const second = hashRechargeCode(normalized, 'test-pepper');

    assert.equal(first, second);
    assert.equal(first.length, 64);
    assert.notEqual(first, normalized);
    assert.doesNotMatch(first, /JF-ABCD/);
});

test('public chat requires authentication and reserves external credits before streaming', async () => {
    const source = await readFile(path.join(frontendRoot, 'app', 'api', 'chat', 'route.ts'), 'utf8');

    assert.doesNotMatch(source, /tryGetUsageUser/);
    assert.match(source, /await getAuthUser\(req\)/);
    assert.match(source, /reserveAiUsageCredits/);
    assert.match(source, /releaseAiUsageCredits/);
});

test('conversation image generation reserves and settles the fixed media charge', async () => {
    const source = await readFile(
        path.join(frontendRoot, 'app', 'api', 'conversations', '[id]', 'messages', 'route.ts'),
        'utf8',
    );

    assert.match(source, /CONVERSATION_IMAGE_USAGE_CHANNEL/);
    assert.match(source, /amount:\s*IMAGE_RESERVATION_CREDITS/);
    assert.match(source, /mediaProduct:\s*'nanobanana2'/);
    assert.match(source, /billableUnits:\s*generated\.resultImagePaths\.length/);
});

test('unexpected API errors do not expose their internal message to clients', async () => {
    const source = await readFile(path.join(frontendRoot, 'app', 'lib', 'auth.ts'), 'utf8');

    assert.match(source, /console\.error\('\[API Error\]', err\)/);
    assert.match(source, /Response\.json\(\{\s*error:\s*'Internal server error\.'/s);
    assert.doesNotMatch(source, /\{\s*error:\s*message\s*\},\s*\{\s*status:\s*500/s);
});
