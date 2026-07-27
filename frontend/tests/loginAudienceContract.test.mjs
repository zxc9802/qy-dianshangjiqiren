import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, '..');
const authRoutePath = path.join(frontendRoot, 'app', 'api', 'auth', 'route.ts');
const authLibraryPath = path.join(frontendRoot, 'app', 'lib', 'auth.ts');
const loginPagePath = path.join(frontendRoot, 'app', 'login', 'page.tsx');
const adminAccountRoutePath = path.join(frontendRoot, 'app', 'api', 'admin', 'users', '[id]', 'route.ts');

test('authentication exposes separate external registration and internal activation paths', async () => {
    const source = await readFile(authRoutePath, 'utf8');

    assert.match(source, /case 'register-external':[\s\S]*handleExternalRegister/);
    assert.match(source, /case 'register-internal':[\s\S]*handleInternalRegister/);
    assert.match(source, /getRegistrationProfile\('external'/);
    assert.match(source, /getRegistrationProfile\('internal'/);
});

test('suspended accounts are blocked from password login and authenticated APIs', async () => {
    const [routeSource, librarySource] = await Promise.all([
        readFile(authRoutePath, 'utf8'),
        readFile(authLibraryPath, 'utf8'),
    ]);

    assert.match(routeSource, /user\.accountStatus !== 'active'[\s\S]*ACCOUNT_SUSPENDED/);
    assert.match(librarySource, /user\.accountStatus !== 'active'[\s\S]*ACCOUNT_SUSPENDED/);
});

test('login page clearly separates shared login, external registration, and internal activation', async () => {
    const source = await readFile(loginPagePath, 'utf8');

    assert.match(source, /'external-register'/);
    assert.match(source, /'internal-register'/);
    assert.match(source, /外部注册/);
    assert.match(source, /内部开通/);
    assert.doesNotMatch(source, /注册外部用户账号/);
    assert.doesNotMatch(source, /开通内部成员账号/);
    assert.doesNotMatch(source, /使用邮箱注册，使用量按成本的 1\.8 倍计算积分/);
    assert.doesNotMatch(source, /需要管理员发放的一次性邀请码，并从员工名单中选择身份/);
});

test('admin cannot suspend or reclassify an administrator as external', async () => {
    const source = await readFile(adminAccountRoutePath, 'utf8');

    assert.match(source, /target\.role === 'admin'/);
    assert.match(source, /Admin accounts must remain active internal accounts/);
});
