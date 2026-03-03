import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../lib/auth';

export async function GET(req: NextRequest) {
    try {
        const userId = getUserId(req);
        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action');

        if (action === 'balance') {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { pointsBalance: true },
            });
            if (!user) throw new AppError('用户不存在', 404);
            return Response.json({ success: true, data: { balance: user.pointsBalance } });
        }

        // Default: transactions list
        const page = Number(searchParams.get('page') || '1');
        const limit = Number(searchParams.get('limit') || '20');
        const type = searchParams.get('type');
        const skip = (page - 1) * limit;

        const where: Record<string, unknown> = { userId };
        if (type) where.type = type;

        const [transactions, total] = await Promise.all([
            prisma.pointsTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
            prisma.pointsTransaction.count({ where }),
        ]);

        return Response.json({ success: true, data: { transactions, total, page, limit } });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function POST(req: NextRequest) {
    try {
        const userId = getUserId(req);
        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action');
        const body = await req.json();

        if (action === 'redeem') {
            const { code } = z.object({ code: z.string().min(1) }).parse(body);
            const redeemCode = await prisma.redeemCode.findUnique({ where: { code } });
            if (!redeemCode) throw new AppError('兑换码不存在');
            if (redeemCode.isUsed) throw new AppError('兑换码已被使用');

            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) throw new AppError('用户不存在', 404);

            const newBalance = user.pointsBalance + redeemCode.pointsAmount;
            await prisma.$transaction([
                prisma.redeemCode.update({ where: { id: redeemCode.id }, data: { isUsed: true, usedBy: userId, usedAt: new Date() } }),
                prisma.user.update({ where: { id: userId }, data: { pointsBalance: newBalance } }),
                prisma.pointsTransaction.create({
                    data: { userId, type: 'redeem', amount: redeemCode.pointsAmount, balanceAfter: newBalance, description: `兑换码充值 ${code}` },
                }),
            ]);
            return Response.json({ success: true, data: { pointsAdded: redeemCode.pointsAmount, newBalance } });
        }

        if (action === 'recharge') {
            const { amount } = z.object({ amount: z.number().int().positive() }).parse(body);
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) throw new AppError('用户不存在', 404);

            const newBalance = user.pointsBalance + amount;
            await prisma.$transaction([
                prisma.user.update({ where: { id: userId }, data: { pointsBalance: newBalance } }),
                prisma.pointsTransaction.create({
                    data: { userId, type: 'recharge', amount, balanceAfter: newBalance, description: `充值 ${amount} 积分` },
                }),
            ]);
            return Response.json({ success: true, data: { pointsAdded: amount, newBalance } });
        }

        return Response.json({ error: '无效的操作' }, { status: 400 });
    } catch (err) {
        return errorResponse(err);
    }
}
