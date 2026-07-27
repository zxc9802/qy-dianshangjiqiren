import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, errorResponse, getAuthUser } from '../../lib/auth';
import { isExternallyBilledAccount } from '../../lib/ai-usage';
import { prisma } from '../../lib/prisma';
import {
    getRechargeCodeLast4,
    hashRechargeCode,
    normalizeRechargeCode,
} from '../../lib/recharge-codes';
import { readRequiredServerEnv, readServerEnv } from '../../lib/server-env';
import { enforceRateLimit, getClientAddress } from '../../lib/security-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const redeemSchema = z.object({
    code: z.string().trim().min(1).max(64),
});

const REDEEM_TRANSACTION_OPTIONS = {
    maxWait: 10_000,
    timeout: 20_000,
} as const;

function getRechargeCodePepper(): string {
    return readServerEnv('RECHARGE_CODE_PEPPER')?.trim()
        || readRequiredServerEnv('JWT_SECRET');
}

export async function GET(req: NextRequest) {
    try {
        const user = await getAuthUser(req);
        const transactions = await prisma.pointsTransaction.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
                id: true,
                type: true,
                amount: true,
                balanceAfter: true,
                description: true,
                createdAt: true,
            },
        });

        return Response.json({
            success: true,
            data: {
                balance: user.pointsBalance,
                transactions,
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const user = await getAuthUser(req);
        if (!isExternallyBilledAccount(user)) {
            throw new AppError('Only external accounts can redeem recharge codes.', 400, 'EXTERNAL_ACCOUNT_REQUIRED');
        }
        await enforceRateLimit({
            scope: 'recharge-redeem:user',
            identifier: user.id,
            limit: 10,
            windowMs: 10 * 60_000,
        });
        await enforceRateLimit({
            scope: 'recharge-redeem:ip',
            identifier: getClientAddress(req),
            limit: 20,
            windowMs: 10 * 60_000,
        });

        const { code: rawCode } = redeemSchema.parse(await req.json());
        const code = normalizeRechargeCode(rawCode);
        const codeHash = hashRechargeCode(code, getRechargeCodePepper());
        const now = new Date();
        const result = await prisma.$transaction(async (tx) => {
            const rechargeCode = await tx.redeemCode.findFirst({
                where: {
                    OR: [
                        { codeHash },
                        { code },
                    ],
                },
            });
            if (!rechargeCode) {
                throw new AppError('Recharge code does not exist.', 400, 'RECHARGE_CODE_INVALID');
            }
            if (rechargeCode.isUsed) {
                throw new AppError('Recharge code has already been used.', 400, 'RECHARGE_CODE_USED');
            }
            if (rechargeCode.revokedAt) {
                throw new AppError('Recharge code has been revoked.', 400, 'RECHARGE_CODE_REVOKED');
            }
            if (rechargeCode.expiresAt && rechargeCode.expiresAt <= now) {
                throw new AppError('Recharge code has expired.', 400, 'RECHARGE_CODE_EXPIRED');
            }

            const claimed = await tx.redeemCode.updateMany({
                where: {
                    id: rechargeCode.id,
                    isUsed: false,
                    revokedAt: null,
                    OR: [
                        { expiresAt: null },
                        { expiresAt: { gt: now } },
                    ],
                },
                data: {
                    isUsed: true,
                    usedBy: user.id,
                    usedAt: new Date(),
                },
            });
            if (claimed.count !== 1) {
                throw new AppError('Recharge code has already been used.', 400, 'RECHARGE_CODE_USED');
            }

            const credited = await tx.user.updateMany({
                where: {
                    id: user.id,
                    pointsBalance: {
                        lte: 2_147_483_647 - rechargeCode.pointsAmount,
                    },
                },
                data: {
                    pointsBalance: {
                        increment: rechargeCode.pointsAmount,
                    },
                },
            });
            if (credited.count !== 1) {
                throw new AppError('Credit balance limit exceeded.', 409, 'CREDIT_BALANCE_LIMIT');
            }
            const updatedUser = await tx.user.findUniqueOrThrow({
                where: { id: user.id },
                select: { pointsBalance: true },
            });

            await tx.pointsTransaction.create({
                data: {
                    userId: user.id,
                    type: 'redeem',
                    amount: rechargeCode.pointsAmount,
                    balanceAfter: updatedUser.pointsBalance,
                    description: `激活码充值 · 尾号 ${rechargeCode.codeLast4 || getRechargeCodeLast4(code)}`,
                    referenceKey: `recharge:${rechargeCode.id}`,
                },
            });

            return {
                pointsAdded: rechargeCode.pointsAmount,
                newBalance: updatedUser.pointsBalance,
            };
        }, REDEEM_TRANSACTION_OPTIONS);

        return Response.json({ success: true, data: result });
    } catch (error) {
        return errorResponse(error);
    }
}
