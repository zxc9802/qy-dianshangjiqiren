import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(__dirname, '..', 'prisma', 'ai_usage_monitoring.sql');

test('AI usage migration includes every user field required by authentication', async () => {
    const source = await readFile(migrationPath, 'utf8');

    assert.match(source, /billing_audience text NOT NULL DEFAULT 'external'/);
    assert.match(source, /account_status text NOT NULL DEFAULT 'active'/);
    assert.match(source, /last_login_at timestamptz/);
    assert.match(source, /auth_token_version integer NOT NULL DEFAULT 0/);
});
