import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, errorResponse, getAuthUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { normalizeRechargeCode } from '../../lib/recharge-codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const redeemSchema = z.object({
    code: z.string().trim().min(1).max(64),
});

const REDEEM_TRANSACTION_OPTIONS = {
    maxWait: 10_000,
    timeout: 20_000,
} as const;

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
        if (user.billingAudience !== 'external') {
            throw new AppError('Only external accounts can redeem recharge codes.', 400, 'EXTERNAL_ACCOUNT_REQUIRED');
        }

        const { code: rawCode } = redeemSchema.parse(await req.json());
        const code = normalizeRechargeCode(rawCode);
        const result = await prisma.$transaction(async (tx) => {
            const rechargeCode = await tx.redeemCode.findUnique({
                where: { code },
            });
            if (!rechargeCode) {
                throw new AppError('Recharge code does not exist.', 400, 'RECHARGE_CODE_INVALID');
            }
            if (rechargeCode.isUsed) {
                throw new AppError('Recharge code has already been used.', 400, 'RECHARGE_CODE_USED');
            }

            const claimed = await tx.redeemCode.updateMany({
                where: {
                    id: rechargeCode.id,
                    isUsed: false,
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

            const updatedUser = await tx.user.update({
                where: { id: user.id },
                data: {
                    pointsBalance: {
                        increment: rechargeCode.pointsAmount,
                    },
                },
                select: { pointsBalance: true },
            });

            await tx.pointsTransaction.create({
                data: {
                    userId: user.id,
                    type: 'redeem',
                    amount: rechargeCode.pointsAmount,
                    balanceAfter: updatedUser.pointsBalance,
                    description: `激活码充值 ${code}`,
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
