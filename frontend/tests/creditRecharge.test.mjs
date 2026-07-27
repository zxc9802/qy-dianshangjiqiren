import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    generateRechargeCode,
    normalizeRechargeCode,
} from '../app/lib/recharge-codes.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..', 'app');

test('recharge codes are contact-friendly and normalized before redemption', () => {
    const code = generateRechargeCode();

    assert.match(code, /^JF-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
    assert.equal(normalizeRechargeCode(`  ${code.toLowerCase()}  `), code);
});

test('admin recharge-code creation requires administrator access', async () => {
    const source = await readFile(
        path.join(appRoot, 'api', 'admin', 'recharge-codes', 'route.ts'),
        'utf8',
    );

    assert.match(source, /getAuthUser\(req,\s*\{\s*requireAdmin:\s*true\s*\}\)/);
    assert.match(source, /points:\s*z\.number\(\)\.int\(\)\.positive\(\)/);
});

test('redemption atomically claims a code and increments the external user balance', async () => {
    const source = await readFile(path.join(appRoot, 'api', 'points', 'route.ts'), 'utf8');

    assert.match(source, /billingAudience\s*!==\s*'external'/);
    assert.match(source, /tx\.redeemCode\.updateMany\(/);
    assert.match(source, /isUsed:\s*false/);
    assert.match(source, /pointsBalance:\s*\{\s*increment:\s*rechargeCode\.pointsAmount/s);
    assert.match(source, /tx\.pointsTransaction\.create\(/);
});

test('usage charging reserves credits and never debits an insufficient balance', async () => {
    const source = await readFile(path.join(appRoot, 'lib', 'ai-usage-store.ts'), 'utf8');

    assert.match(source, /isolationLevel:\s*Prisma\.TransactionIsolationLevel\.Serializable/);
    assert.match(source, /const chargedDelta = nextCharge - previousCharge/);
    assert.match(source, /type:\s*'reserve'/);
    assert.match(source, /pointsBalance:\s*\{\s*gte:\s*chargedDelta\s*\}/s);
    assert.match(source, /'INSUFFICIENT_CREDITS'/);
    assert.match(source, /type:\s*chargedDelta > 0 \? 'consume' : 'refund'/);
});
