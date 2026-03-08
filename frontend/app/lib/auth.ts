import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { prisma } from './prisma';
import { readRequiredServerEnv, readServerEnv } from './server-env';

const JWT_EXPIRES_IN = readServerEnv('JWT_EXPIRES_IN') || '7d';
const ACCESS_CONTROL_BOOTSTRAP_KEY = 'access_control_v1_bootstrapped';

type AuthUser = Awaited<ReturnType<typeof loadUserById>>;

export interface AuthOptions {
    allowUnauthorizedMembers?: boolean;
    requireAdmin?: boolean;
}

let bootstrapPromise: Promise<void> | null = null;
let bootstrapComplete = false;

function getJwtSecret(): string {
    return readRequiredServerEnv('JWT_SECRET');
}

export function signToken(userId: string): string {
    return jwt.sign(
        { userId },
        getJwtSecret(),
        { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions,
    );
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
    const adminAccount = readServerEnv('ADMIN_ACCOUNT')?.trim();
    const adminPassword = readServerEnv('ADMIN_PASSWORD');
    const adminNickname = readServerEnv('ADMIN_NICKNAME')?.trim();

    const existingSetting = await prisma.systemSetting.findUnique({
        where: { key: ACCESS_CONTROL_BOOTSTRAP_KEY },
        select: { key: true },
    });

    if (existingSetting) {
        bootstrapComplete = true;
        return;
    }

    let adminUser = await prisma.user.findFirst({
        where: { role: 'admin' },
        select: { id: true },
    });

    if (!adminUser && adminAccount && adminPassword) {
        const existingAccount = await prisma.user.findUnique({
            where: { email: adminAccount },
            select: { id: true, nickname: true },
        });

        if (existingAccount) {
            adminUser = await prisma.user.update({
                where: { id: existingAccount.id },
                data: {
                    role: 'admin',
                    isVerified: true,
                    nickname: existingAccount.nickname || adminNickname || adminAccount,
                },
                select: { id: true },
            });
        } else {
            const passwordHash = await bcrypt.hash(adminPassword, 10);
            adminUser = await prisma.user.create({
                data: {
                    email: adminAccount,
                    passwordHash,
                    isVerified: true,
                    role: 'admin',
                    nickname: adminNickname || adminAccount,
                },
                select: { id: true },
            });
        }
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
            avatar: true,
            createdAt: true,
            role: true,
            accessGrantedAt: true,
        },
    });
}

export async function getAuthUser(req: NextRequest, options: AuthOptions = {}): Promise<NonNullable<AuthUser>> {
    await ensureAccessControlBootstrap();

    const token = getBearerToken(req);
    let decoded: { userId: string };

    try {
        decoded = jwt.verify(token, getJwtSecret()) as { userId: string };
    } catch {
        throw new AuthError('Login expired. Please sign in again.');
    }

    const user = await loadUserById(decoded.userId);
    if (!user) {
        throw new AuthError('Account not found.');
    }

    if (options.requireAdmin && user.role !== 'admin') {
        throw new AuthError('Admin access required.', 403, 'FORBIDDEN_ADMIN_ONLY');
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

export function errorResponse(err: unknown) {
    if (err instanceof AuthError) {
        return Response.json(
            { error: err.message, ...(err.code ? { code: err.code } : {}) },
            { status: err.status },
        );
    }
    if (err instanceof AppError) {
        return Response.json(
            { error: err.message, ...(err.code ? { code: err.code } : {}) },
            { status: err.status },
        );
    }
    if (err && typeof err === 'object' && 'issues' in err) {
        const firstIssue = (err as { issues: { message: string }[] }).issues[0];
        return Response.json({ error: firstIssue?.message || 'Invalid request.' }, { status: 400 });
    }

    const message = err instanceof Error ? err.message : 'Internal server error.';
    console.error('[API Error]', message);
    return Response.json({ error: message }, { status: 500 });
}

