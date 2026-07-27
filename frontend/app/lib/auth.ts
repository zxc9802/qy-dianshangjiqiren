import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { prisma } from './prisma';
import { readRequiredServerEnv, readServerEnv } from './server-env';

const JWT_EXPIRES_IN = readServerEnv('JWT_EXPIRES_IN') || '7d';
const ACCESS_CONTROL_BOOTSTRAP_KEY = 'access_control_v1_bootstrapped';

type AuthUser = Awaited<ReturnType<typeof loadUserById>>;
type AuthTokenPayload = { userId: string; tokenVersion?: number };

export interface AuthOptions {
    allowUnauthorizedMembers?: boolean;
    requireAdmin?: boolean;
}

let bootstrapPromise: Promise<void> | null = null;
let bootstrapComplete = false;

function getJwtSecret(): string {
    return readRequiredServerEnv('JWT_SECRET');
}

export function signToken(userId: string, authTokenVersion = 0, expiresIn = JWT_EXPIRES_IN): string {
    return jwt.sign(
        { userId, tokenVersion: authTokenVersion },
        getJwtSecret(),
        { expiresIn } as jwt.SignOptions,
    );
}

export function getTokenExpiresAt(token: string): number {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded === 'string' || typeof decoded.exp !== 'number') {
        throw new Error('Signed token is missing an expiration.');
    }

    return decoded.exp * 1000;
}

export async function ensureAccessControlBootstrap(): Promise<void> {
    if (bootstrapComplete) {
        return;
    }

    if (!bootstrapPromise) {
        bootstrapPromise = runAccessControlBootstrap().catch((error) => {
            bootstrapPromise = null;
            throw error;
        });
    }

    await bootstrapPromise;
}

async function runAccessControlBootstrap(): Promise<void> {
    await ensureAuthTokenVersionColumn();
    await ensureSecurityStorage();

    const adminAccount = readServerEnv('ADMIN_ACCOUNT')?.trim();
    const adminPassword = readServerEnv('ADMIN_PASSWORD');
    const adminNickname = readServerEnv('ADMIN_NICKNAME')?.trim();

    await syncAdminAccount(adminAccount, adminPassword, adminNickname);

    const existingSetting = await prisma.systemSetting.findUnique({
        where: { key: ACCESS_CONTROL_BOOTSTRAP_KEY },
        select: { key: true },
    });

    if (existingSetting) {
        bootstrapComplete = true;
        return;
    }

    await prisma.user.updateMany({
        where: {
            role: { not: 'admin' },
            accessGrantedAt: { not: null },
        },
        data: { accessGrantedAt: null },
    });

    await prisma.systemSetting.upsert({
        where: { key: ACCESS_CONTROL_BOOTSTRAP_KEY },
        update: {},
        create: {
            key: ACCESS_CONTROL_BOOTSTRAP_KEY,
            value: new Date().toISOString(),
        },
    });

    bootstrapComplete = true;
}

async function ensureAuthTokenVersionColumn(): Promise<void> {
    await prisma.$executeRawUnsafe(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS auth_token_version integer NOT NULL DEFAULT 0
    `);
}

async function ensureSecurityStorage(): Promise<void> {
    await prisma.$executeRawUnsafe(`
        ALTER TABLE points_transactions
        ADD COLUMN IF NOT EXISTS reference_key text
    `);
    await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS points_transactions_reference_key_key
        ON points_transactions (reference_key)
        WHERE reference_key IS NOT NULL
    `);
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS points_transactions_user_id_created_at_idx
        ON points_transactions (user_id, created_at DESC)
    `);
    await prisma.$executeRawUnsafe(`
        ALTER TABLE redeem_codes
        ADD COLUMN IF NOT EXISTS code_hash text,
        ADD COLUMN IF NOT EXISTS code_last4 text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS expires_at timestamp(3),
        ADD COLUMN IF NOT EXISTS revoked_at timestamp(3),
        ADD COLUMN IF NOT EXISTS created_by_user_id text,
        ADD COLUMN IF NOT EXISTS revoked_by_user_id text,
        ADD COLUMN IF NOT EXISTS remark text NOT NULL DEFAULT ''
    `);
    await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS redeem_codes_code_hash_key
        ON redeem_codes (code_hash)
        WHERE code_hash IS NOT NULL
    `);
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS request_rate_limits (
            key text PRIMARY KEY,
            count integer NOT NULL DEFAULT 0,
            window_started_at timestamp(3) NOT NULL,
            blocked_until timestamp(3),
            updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS request_rate_limits_updated_at_idx
        ON request_rate_limits (updated_at)
    `);
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id text PRIMARY KEY,
            admin_user_id text NOT NULL,
            action text NOT NULL,
            target_type text NOT NULL,
            target_id text,
            metadata jsonb,
            created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS admin_audit_logs_admin_user_id_created_at_idx
        ON admin_audit_logs (admin_user_id, created_at DESC)
    `);
}

async function syncAdminAccount(
    adminAccount?: string,
    adminPassword?: string,
    adminNickname?: string,
): Promise<void> {
    if (!adminAccount || !adminPassword) {
        return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const existingAccount = await prisma.user.findUnique({
        where: { email: adminAccount },
        select: { id: true, nickname: true },
    });

    if (existingAccount) {
        await prisma.user.update({
            where: { id: existingAccount.id },
            data: {
                passwordHash,
                role: 'admin',
                billingAudience: 'internal',
                accountStatus: 'active',
                isVerified: true,
                nickname: existingAccount.nickname || adminNickname || adminAccount,
            },
        });
        return;
    }

    await prisma.user.create({
        data: {
            email: adminAccount,
            passwordHash,
            isVerified: true,
            role: 'admin',
            billingAudience: 'internal',
            accountStatus: 'active',
            nickname: adminNickname || adminAccount,
        },
    });
}

function getBearerToken(req: NextRequest): string {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        throw new AuthError('Please log in first.');
    }

    return authHeader.slice('Bearer '.length);
}

async function loadUserById(userId: string) {
    return prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            nickname: true,
            groupName: true,
            billingAudience: true,
            accountStatus: true,
            lastLoginAt: true,
            avatar: true,
            createdAt: true,
            role: true,
            accessGrantedAt: true,
            authTokenVersion: true,
            pointsBalance: true,
        },
    });
}

export async function getAuthUser(req: NextRequest, options: AuthOptions = {}): Promise<NonNullable<AuthUser>> {
    await ensureAccessControlBootstrap();

    const token = getBearerToken(req);
    let decoded: AuthTokenPayload;

    try {
        decoded = jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
    } catch {
        throw new AuthError('Login expired. Please sign in again.');
    }

    const user = await loadUserById(decoded.userId);
    if (!user) {
        throw new AuthError('Account not found.');
    }

    if (decoded.tokenVersion !== user.authTokenVersion && !(decoded.tokenVersion === undefined && user.authTokenVersion === 0)) {
        throw new AuthError('Login expired. Please sign in again.', 401, 'SESSION_REVOKED');
    }

    if (options.requireAdmin && user.role !== 'admin') {
        throw new AuthError('Admin access required.', 403, 'FORBIDDEN_ADMIN_ONLY');
    }

    if (user.accountStatus !== 'active') {
        throw new AuthError('This account has been suspended.', 403, 'ACCOUNT_SUSPENDED');
    }

    const hasAccess = user.role === 'admin' || Boolean(user.accessGrantedAt);
    if (!options.allowUnauthorizedMembers && !hasAccess) {
        throw new AuthError('Invite code required.', 403, 'INVITE_REQUIRED');
    }

    return user;
}

export async function getUserId(req: NextRequest, options: AuthOptions = {}): Promise<string> {
    const user = await getAuthUser(req, options);
    return user.id;
}

export async function revokeAuthSession(req: NextRequest): Promise<void> {
    await ensureAccessControlBootstrap();

    const token = getBearerToken(req);
    let decoded: AuthTokenPayload;

    try {
        decoded = jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
    } catch {
        throw new AuthError('Login expired. Please sign in again.');
    }

    await prisma.user.update({
        where: { id: decoded.userId },
        data: {
            authTokenVersion: { increment: 1 },
        },
        select: { id: true },
    });
}

export class AuthError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status = 401, code?: string) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'AuthError';
    }
}

export class AppError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status = 400, code?: string) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'AppError';
    }
}

export function getPublicErrorMessage(err: unknown, fallback = 'Request failed.'): string {
    if (err instanceof AuthError || err instanceof AppError) {
        return err.status < 500 ? err.message : fallback;
    }
    return fallback;
}

export function errorResponse(err: unknown) {
    if (err instanceof AuthError) {
        return Response.json(
            { error: err.message, ...(err.code ? { code: err.code } : {}) },
            { status: err.status },
        );
    }
    if (err instanceof AppError) {
        if (err.status >= 500) {
            console.error('[API Error]', err);
            return Response.json(
                { error: 'Internal server error.', ...(err.code ? { code: err.code } : {}) },
                { status: err.status },
            );
        }
        return Response.json(
            { error: err.message, ...(err.code ? { code: err.code } : {}) },
            { status: err.status },
        );
    }
    if (err && typeof err === 'object' && 'issues' in err) {
        const firstIssue = (err as { issues: { message: string }[] }).issues[0];
        return Response.json({ error: firstIssue?.message || 'Invalid request.' }, { status: 400 });
    }

    console.error('[API Error]', err);
    return Response.json({ error: 'Internal server error.' }, { status: 500 });
}
