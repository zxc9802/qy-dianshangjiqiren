import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, errorResponse, getAuthUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import {
    generateRechargeCode,
    getRechargeCodeLast4,
    hashRechargeCode,
    maskRechargeCode,
} from '../../../lib/recharge-codes';
import { readRequiredServerEnv, readServerEnv } from '../../../lib/server-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
    points: z.number().int().positive().max(100_000_000),
    expiresInDays: z.number().int().min(1).max(3650).default(30),
    remark: z.string().trim().max(200).default(''),
});

const revokeSchema = z.object({
    id: z.string().uuid(),
});

function getRechargeCodePepper(): string {
    return readServerEnv('RECHARGE_CODE_PEPPER')?.trim()
        || readRequiredServerEnv('JWT_SECRET');
}

async function createRechargeCodeWithAudit(input: {
    points: number;
    expiresAt: Date;
    remark: string;
    adminUserId: string;
}) {
    const plaintextCode = generateRechargeCode();
    const codeHash = hashRechargeCode(plaintextCode, getRechargeCodePepper());
    return prisma.$transaction(async (tx) => {
        const created = await tx.redeemCode.create({
            data: {
                code: `HMAC-SHA256:${codeHash}`,
                codeHash,
                codeLast4: getRechargeCodeLast4(plaintextCode),
                pointsAmount: input.points,
                expiresAt: input.expiresAt,
                remark: input.remark,
                createdByUserId: input.adminUserId,
            },
        });
        await tx.adminAuditLog.create({
            data: {
                adminUserId: input.adminUserId,
                action: 'recharge_code.create',
                targetType: 'redeem_code',
                targetId: created.id,
                metadata: {
                    points: input.points,
                    expiresAt: input.expiresAt.toISOString(),
                    remark: input.remark,
                },
            },
        });
        return { created, plaintextCode };
    });
}

export async function GET(req: NextRequest) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const codes = await prisma.redeemCode.findMany({
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        const usedByIds = [...new Set(codes.flatMap((item) => item.usedBy ? [item.usedBy] : []))];
        const users = usedByIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: usedByIds } },
                select: { id: true, email: true, nickname: true },
            })
            : [];
        const userById = new Map(users.map((user) => [user.id, user]));

        return Response.json({
            success: true,
            data: codes.map((item) => ({
                id: item.id,
                code: maskRechargeCode(item.codeLast4 || getRechargeCodeLast4(item.code)),
                codeVisibleOnce: false,
                points: item.pointsAmount,
                isUsed: item.isUsed,
                usedAt: item.usedAt,
                expiresAt: item.expiresAt,
                revokedAt: item.revokedAt,
                remark: item.remark,
                createdAt: item.createdAt,
                usedBy: item.usedBy
                    ? {
                        id: item.usedBy,
                        account: userById.get(item.usedBy)?.email || '',
                        nickname: userById.get(item.usedBy)?.nickname || '',
                    }
                    : null,
            })),
        });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const admin = await getAuthUser(req, { requireAdmin: true });
        const { points, expiresInDays, remark } = createSchema.parse(await req.json());
        const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
        let result: Awaited<ReturnType<typeof createRechargeCodeWithAudit>> | null = null;
        for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
                result = await createRechargeCodeWithAudit({
                    points,
                    expiresAt,
                    remark,
                    adminUserId: admin.id,
                });
                break;
            } catch (error) {
                const isCodeCollision = (
                    error instanceof Prisma.PrismaClientKnownRequestError
                    && error.code === 'P2002'
                );
                if (!isCodeCollision) {
                    throw error;
                }
            }
        }
        if (!result) {
            throw new AppError(
                'Unable to generate a unique recharge code.',
                503,
                'RECHARGE_CODE_GENERATION_FAILED',
            );
        }
        const { created, plaintextCode } = result;

        return Response.json({
            success: true,
            data: {
                id: created.id,
                code: plaintextCode,
                codeVisibleOnce: true,
                points: created.pointsAmount,
                isUsed: created.isUsed,
                usedAt: created.usedAt,
                expiresAt: created.expiresAt,
                revokedAt: created.revokedAt,
                remark: created.remark,
                createdAt: created.createdAt,
                usedBy: null,
            },
        }, { status: 201 });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const admin = await getAuthUser(req, { requireAdmin: true });
        const { id } = revokeSchema.parse(await req.json());
        const revoked = await prisma.$transaction(async (tx) => {
            const existing = await tx.redeemCode.findUnique({
                where: { id },
                select: {
                    id: true,
                    isUsed: true,
                    revokedAt: true,
                },
            });
            if (!existing) {
                throw new AppError('Recharge code not found.', 404, 'RECHARGE_CODE_NOT_FOUND');
            }
            if (existing.isUsed) {
                throw new AppError('Used recharge codes cannot be revoked.', 409, 'RECHARGE_CODE_ALREADY_USED');
            }
            if (existing.revokedAt) {
                return existing;
            }

            const revokedAt = new Date();
            const claimed = await tx.redeemCode.updateMany({
                where: {
                    id,
                    isUsed: false,
                    revokedAt: null,
                },
                data: {
                    revokedAt,
                    revokedByUserId: admin.id,
                },
            });
            if (claimed.count !== 1) {
                const current = await tx.redeemCode.findUnique({
                    where: { id },
                    select: {
                        id: true,
                        isUsed: true,
                        revokedAt: true,
                    },
                });
                if (current?.isUsed) {
                    throw new AppError('Used recharge codes cannot be revoked.', 409, 'RECHARGE_CODE_ALREADY_USED');
                }
                if (current?.revokedAt) {
                    return current;
                }
                throw new AppError('Recharge code not found.', 404, 'RECHARGE_CODE_NOT_FOUND');
            }
            await tx.adminAuditLog.create({
                data: {
                    adminUserId: admin.id,
                    action: 'recharge_code.revoke',
                    targetType: 'redeem_code',
                    targetId: id,
                },
            });
            return { id, revokedAt };
        });

        return Response.json({
            success: true,
            data: revoked,
        });
    } catch (error) {
        return errorResponse(error);
    }
}
