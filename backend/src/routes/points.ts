import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/error';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

router.use(authMiddleware);

// 查询余额
router.get('/balance', async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { pointsBalance: true },
    });
    if (!user) throw new AppError('用户不存在', 404);
    res.json({ success: true, data: { balance: user.pointsBalance } });
});

// 积分明细
router.get('/transactions', async (req: AuthRequest, res: Response) => {
    const { page = '1', limit = '20', type } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = { userId: req.userId };
    if (type && typeof type === 'string') where.type = type;

    const [transactions, total] = await Promise.all([
        prisma.pointsTransaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: Number(limit),
        }),
        prisma.pointsTransaction.count({ where }),
    ]);

    res.json({ success: true, data: { transactions, total, page: Number(page), limit: Number(limit) } });
});

// 兑换码充值
router.post('/redeem', async (req: AuthRequest, res: Response) => {
    const schema = z.object({ code: z.string().min(1) });
    const { code } = schema.parse(req.body);

    const redeemCode = await prisma.redeemCode.findUnique({ where: { code } });
    if (!redeemCode) throw new AppError('兑换码不存在', 400);
    if (redeemCode.isUsed) throw new AppError('兑换码已被使用', 400);

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new AppError('用户不存在', 404);

    const newBalance = user.pointsBalance + redeemCode.pointsAmount;

    await prisma.$transaction([
        prisma.redeemCode.update({
            where: { id: redeemCode.id },
            data: { isUsed: true, usedBy: req.userId, usedAt: new Date() },
        }),
        prisma.user.update({
            where: { id: req.userId },
            data: { pointsBalance: newBalance },
        }),
        prisma.pointsTransaction.create({
            data: {
                userId: req.userId!,
                type: 'redeem',
                amount: redeemCode.pointsAmount,
                balanceAfter: newBalance,
                description: `兑换码充值 ${code}`,
            },
        }),
    ]);

    res.json({ success: true, data: { pointsAdded: redeemCode.pointsAmount, newBalance } });
});

// 模拟充值（开发环境）
router.post('/recharge', async (req: AuthRequest, res: Response) => {
    const schema = z.object({ amount: z.number().int().positive() });
    const { amount } = schema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new AppError('用户不存在', 404);

    const newBalance = user.pointsBalance + amount;

    await prisma.$transaction([
        prisma.user.update({
            where: { id: req.userId },
            data: { pointsBalance: newBalance },
        }),
        prisma.pointsTransaction.create({
            data: {
                userId: req.userId!,
                type: 'recharge',
                amount,
                balanceAfter: newBalance,
                description: `充值 ${amount} 积分`,
            },
        }),
    ]);

    res.json({ success: true, data: { pointsAdded: amount, newBalance } });
});

export default router;
