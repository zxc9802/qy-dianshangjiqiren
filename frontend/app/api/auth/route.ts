import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { isAllowedGroupName, isAllowedMemberName } from '../../lib/member-directory';
import {
    isExternalRegistrationEnabled,
    RegistrationProfileError,
    resolveRegistrationProfile,
} from '../../lib/account-registration';
import { readServerEnv } from '../../lib/server-env';
import {
    signToken,
    AppError,
    errorResponse,
    ensureAccessControlBootstrap,
    revokeAuthSession,
} from '../../lib/auth';

const accountSchema = z.string().trim().min(3, 'Account must be at least 3 characters.').max(64, 'Account is too long.');
const externalAccountSchema = z.string().trim().email('Please enter a valid email address.').max(191, 'Email is too long.');
const passwordSchema = z.string().min(6, 'Password must be at least 6 characters.').max(128, 'Password is too long.');
const externalPasswordSchema = z.string().min(8, 'Password must be at least 8 characters.').max(128, 'Password is too long.');
const inviteCodeSchema = z.string().trim().min(6, 'Invite code is required.').max(32, 'Invite code is invalid.');
const nicknameSchema = z.string().trim().min(1, 'Name is required.').max(20, 'Name is too long.');
const externalNicknameSchema = z.string().trim().min(1, 'Nickname is required.').max(40, 'Nickname is too long.');
const optionalNicknameSchema = z.string().trim().max(20, 'Name is too long.').optional();
const groupNameSchema = z.string().trim().min(1, 'Group is required.').max(50, 'Group is too long.');
const optionalGroupNameSchema = z.string().trim().max(50, 'Group is too long.').optional();

const internalRegisterSchema = z.object({
    account: accountSchema,
    password: passwordSchema,
    nickname: nicknameSchema,
    groupName: groupNameSchema,
    inviteCode: inviteCodeSchema,
});

const externalRegisterSchema = z.object({
    account: externalAccountSchema,
    password: externalPasswordSchema,
    nickname: externalNicknameSchema,
});

const loginSchema = z.object({
    account: z.string().trim().min(3, 'Account must be at least 3 characters.').max(191, 'Account is too long.'),
    password: z.string().max(128, 'Password is too long.'),
});

const activateSchema = z.object({
    account: accountSchema,
    password: z.string(),
    inviteCode: inviteCodeSchema,
    nickname: optionalNicknameSchema,
    groupName: optionalGroupNameSchema,
});

const AUTH_TRANSACTION_OPTIONS = {
    maxWait: 10_000,
    timeout: 20_000,
} as const;

export async function POST(req: NextRequest) {
    try {
        await ensureAccessControlBootstrap();

        const url = new URL(req.url);
        const action = url.searchParams.get('action');
        const body = await req.json();

        switch (action) {
            case 'register':
            case 'register-internal':
                return await handleInternalRegister(body);
            case 'register-external':
                return await handleExternalRegister(body);
            case 'login':
                return await handleLogin(body);
            case 'activate':
                return await handleActivate(body);
            case 'logout':
                return await handleLogout(req);
            default:
                throw new AppError('Invalid auth action.', 400);
        }
    } catch (err) {
        return errorResponse(err);
    }
}

function normalizeAccount(account: string): string {
    return account.trim();
}

function normalizeExternalAccount(account: string): string {
    return account.trim().toLowerCase();
}

function normalizeInviteCode(code: string): string {
    return code.trim().toUpperCase();
}

function normalizeProfileValue(value: string | undefined): string {
    return value?.trim() || '';
}

function getRegistrationProfile(
    kind: 'internal' | 'external',
    nickname: string,
    groupName?: string,
) {
    try {
        return resolveRegistrationProfile({
            kind,
            nickname,
            groupName,
        }, {
            includesMember: isAllowedMemberName,
            includesGroup: isAllowedGroupName,
        });
    } catch (error) {
        if (error instanceof RegistrationProfileError) {
            throw new AppError(error.message, 400, error.code);
        }
        throw error;
    }
}

function parseRequestBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new AppError(result.error.issues[0]?.message || 'Invalid request.', 400);
    }

    return result.data;
}

function toUserPayload(user: {
    id: string;
    email: string;
    nickname: string;
    groupName: string;
    billingAudience: string;
    accountStatus: string;
    lastLoginAt?: Date | null;
    avatar: string;
    role: string;
    pointsBalance: number;
    createdAt?: Date;
}) {
    return {
        id: user.id,
        account: user.email,
        nickname: user.nickname,
        groupName: user.groupName,
        billingAudience: user.billingAudience,
        accountStatus: user.accountStatus,
        lastLoginAt: user.lastLoginAt || null,
        avatar: user.avatar,
        role: user.role,
        pointsBalance: user.pointsBalance,
        ...(user.createdAt ? { createdAt: user.createdAt } : {}),
    };
}

function issueAuthResponse(user: {
    id: string;
    email: string;
    nickname: string;
    groupName: string;
    billingAudience: string;
    accountStatus: string;
    lastLoginAt?: Date | null;
    avatar: string;
    role: string;
    authTokenVersion: number;
    pointsBalance: number;
    createdAt?: Date;
}, status = 200) {
    return Response.json({
        success: true,
        data: {
            token: signToken(user.id, user.authTokenVersion),
            user: toUserPayload(user),
        },
    }, { status });
}

async function consumeInviteCode(tx: Prisma.TransactionClient, inviteCode: string, userId: string) {
    const invite = await tx.inviteCode.findUnique({
        where: { code: inviteCode },
        select: { id: true, usedByUserId: true },
    });

    if (!invite || invite.usedByUserId) {
        throw new AppError('Invite code is invalid.', 400, 'INVITE_CODE_INVALID');
    }

    const consumeResult = await tx.inviteCode.updateMany({
        where: { id: invite.id, usedByUserId: null },
        data: {
            usedByUserId: userId,
            usedAt: new Date(),
        },
    });

    if (consumeResult.count !== 1) {
        throw new AppError('Invite code is invalid.', 400, 'INVITE_CODE_INVALID');
    }
}

async function handleInternalRegister(body: unknown) {
    const data = parseRequestBody(internalRegisterSchema, body);
    const account = normalizeAccount(data.account);
    const inviteCode = normalizeInviteCode(data.inviteCode);
    const profile = getRegistrationProfile('internal', data.nickname, data.groupName);

    const user = await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({
            where: { email: account },
            select: {
                id: true,
                email: true,
                passwordHash: true,
                nickname: true,
                groupName: true,
                billingAudience: true,
                accountStatus: true,
                lastLoginAt: true,
                avatar: true,
                role: true,
                accessGrantedAt: true,
                authTokenVersion: true,
                pointsBalance: true,
                createdAt: true,
            },
        });

        if (existing) {
            if (existing.role !== 'admin' && !existing.accessGrantedAt) {
                const valid = await bcrypt.compare(data.password, existing.passwordHash);
                if (!valid) {
                    throw new AppError('Incorrect password.', 400);
                }

                await consumeInviteCode(tx, inviteCode, existing.id);

                return tx.user.update({
                    where: { id: existing.id },
                    data: {
                        accessGrantedAt: new Date(),
                        isVerified: true,
                        nickname: profile.nickname,
                        groupName: profile.groupName,
                        billingAudience: profile.billingAudience,
                        accountStatus: 'active',
                        lastLoginAt: new Date(),
                    },
                    select: {
                        id: true,
                        email: true,
                        nickname: true,
                        groupName: true,
                        billingAudience: true,
                        accountStatus: true,
                        lastLoginAt: true,
                        avatar: true,
                        role: true,
                        authTokenVersion: true,
                        pointsBalance: true,
                        createdAt: true,
                    },
                });
            }
            throw new AppError('Account already exists.', 409);
        }

        const passwordHash = await bcrypt.hash(data.password, 10);
        const createdUser = await tx.user.create({
            data: {
                email: account,
                passwordHash,
                isVerified: true,
                role: 'member',
                accessGrantedAt: new Date(),
                nickname: profile.nickname,
                groupName: profile.groupName,
                billingAudience: profile.billingAudience,
                accountStatus: 'active',
                lastLoginAt: new Date(),
            },
            select: {
                id: true,
                email: true,
                nickname: true,
                groupName: true,
                billingAudience: true,
                accountStatus: true,
                lastLoginAt: true,
                avatar: true,
                role: true,
                authTokenVersion: true,
                pointsBalance: true,
                createdAt: true,
            },
        });

        await consumeInviteCode(tx, inviteCode, createdUser.id);

        return createdUser;
    }, AUTH_TRANSACTION_OPTIONS);

    return issueAuthResponse(user, 201);
}

async function handleExternalRegister(body: unknown) {
    if (!isExternalRegistrationEnabled(readServerEnv('EXTERNAL_REGISTRATION_ENABLED'))) {
        throw new AppError(
            'External registration is temporarily disabled.',
            403,
            'EXTERNAL_REGISTRATION_DISABLED',
        );
    }

    const data = parseRequestBody(externalRegisterSchema, body);
    const account = normalizeExternalAccount(data.account);
    const profile = getRegistrationProfile('external', data.nickname);

    const existing = await prisma.user.findFirst({
        where: {
            email: {
                equals: account,
                mode: 'insensitive',
            },
        },
        select: { id: true },
    });
    if (existing) {
        throw new AppError('Account already exists.', 409, 'ACCOUNT_ALREADY_EXISTS');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    let user;
    try {
        user = await prisma.user.create({
            data: {
                email: account,
                passwordHash,
                isVerified: true,
                role: 'member',
                accessGrantedAt: new Date(),
                nickname: profile.nickname,
                groupName: profile.groupName,
                billingAudience: profile.billingAudience,
                accountStatus: 'active',
                lastLoginAt: new Date(),
            },
            select: {
                id: true,
                email: true,
                nickname: true,
                groupName: true,
                billingAudience: true,
                accountStatus: true,
                lastLoginAt: true,
                avatar: true,
                role: true,
                authTokenVersion: true,
                pointsBalance: true,
                createdAt: true,
            },
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new AppError('Account already exists.', 409, 'ACCOUNT_ALREADY_EXISTS');
        }
        throw error;
    }

    return issueAuthResponse(user, 201);
}

async function handleLogin(body: unknown) {
    const data = parseRequestBody(loginSchema, body);
    const account = normalizeAccount(data.account);

    let user = await prisma.user.findUnique({
        where: { email: account },
        select: {
            id: true,
            email: true,
            passwordHash: true,
            nickname: true,
            groupName: true,
            billingAudience: true,
            accountStatus: true,
            lastLoginAt: true,
            avatar: true,
            role: true,
            accessGrantedAt: true,
            authTokenVersion: true,
            pointsBalance: true,
            createdAt: true,
        },
    });
    if (!user && account.includes('@') && account.toLowerCase() !== account) {
        user = await prisma.user.findUnique({
            where: { email: account.toLowerCase() },
            select: {
                id: true,
                email: true,
                passwordHash: true,
                nickname: true,
                groupName: true,
                billingAudience: true,
                accountStatus: true,
                lastLoginAt: true,
                avatar: true,
                role: true,
                accessGrantedAt: true,
                authTokenVersion: true,
                pointsBalance: true,
                createdAt: true,
            },
        });
    }

    if (!user) {
        throw new AppError('Account not found.', 404);
    }

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) {
        throw new AppError('Incorrect password.', 400);
    }

    if (user.accountStatus !== 'active') {
        throw new AppError('This account has been suspended.', 403, 'ACCOUNT_SUSPENDED');
    }

    if (user.role !== 'admin' && !user.accessGrantedAt) {
        throw new AppError('Invite code required.', 403, 'INVITE_REQUIRED');
    }

    const authenticatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
        select: {
            id: true,
            email: true,
            nickname: true,
            groupName: true,
            billingAudience: true,
            accountStatus: true,
            lastLoginAt: true,
            avatar: true,
            role: true,
            authTokenVersion: true,
            pointsBalance: true,
            createdAt: true,
        },
    });

    return issueAuthResponse(authenticatedUser);
}

async function handleActivate(body: unknown) {
    const data = parseRequestBody(activateSchema, body);
    const account = normalizeAccount(data.account);
    const inviteCode = normalizeInviteCode(data.inviteCode);

    const user = await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({
            where: { email: account },
            select: {
                id: true,
                email: true,
                passwordHash: true,
                nickname: true,
                groupName: true,
                billingAudience: true,
                accountStatus: true,
                lastLoginAt: true,
                avatar: true,
                role: true,
                accessGrantedAt: true,
                authTokenVersion: true,
                pointsBalance: true,
                createdAt: true,
            },
        });

        if (!existing) {
            throw new AppError('Account not found.', 404);
        }

        const valid = await bcrypt.compare(data.password, existing.passwordHash);
        if (!valid) {
            throw new AppError('Incorrect password.', 400);
        }

        if (existing.accountStatus !== 'active') {
            throw new AppError('This account has been suspended.', 403, 'ACCOUNT_SUSPENDED');
        }

        if (existing.role === 'admin' || existing.accessGrantedAt) {
            return tx.user.update({
                where: { id: existing.id },
                data: { lastLoginAt: new Date() },
                select: {
                    id: true,
                    email: true,
                    nickname: true,
                    groupName: true,
                    billingAudience: true,
                    accountStatus: true,
                    lastLoginAt: true,
                    avatar: true,
                    role: true,
                    authTokenVersion: true,
                    pointsBalance: true,
                    createdAt: true,
                },
            });
        }

        const profile = getRegistrationProfile(
            'internal',
            normalizeProfileValue(data.nickname) || existing.nickname,
            normalizeProfileValue(data.groupName) || existing.groupName,
        );

        await consumeInviteCode(tx, inviteCode, existing.id);

        return tx.user.update({
            where: { id: existing.id },
            data: {
                accessGrantedAt: new Date(),
                isVerified: true,
                nickname: profile.nickname,
                groupName: profile.groupName,
                billingAudience: profile.billingAudience,
                accountStatus: 'active',
                lastLoginAt: new Date(),
            },
            select: {
                id: true,
                email: true,
                nickname: true,
                groupName: true,
                billingAudience: true,
                accountStatus: true,
                lastLoginAt: true,
                avatar: true,
                role: true,
                authTokenVersion: true,
                pointsBalance: true,
                createdAt: true,
            },
        });
    }, AUTH_TRANSACTION_OPTIONS);

    return issueAuthResponse(user);
}

async function handleLogout(req: NextRequest) {
    await revokeAuthSession(req);
    return Response.json({ success: true });
}
