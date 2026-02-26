import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/error';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

const registerSchema = z.object({
    phone: z.string().regex(/^1[3-9]\d{9}$/, '请输入有效的手机号'),
    password: z.string().min(6, '密码至少6位'),
    nickname: z.string().optional(),
    inviteCode: z.string().optional(),
});

const loginSchema = z.object({
    phone: z.string(),
    password: z.string(),
});

function signToken(userId: string): string {
    return jwt.sign(
        { userId },
        process.env.JWT_SECRET || 'fallback-secret',
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as jwt.SignOptions
    );
}

// 注册
router.post('/register', async (req: Request, res: Response) => {
    const data = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { phone: data.phone } });
    if (existing) {
        throw new AppError('该手机号已注册', 400);
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
        data: {
            phone: data.phone,
            passwordHash,
            nickname: data.nickname || `用户${data.phone.slice(-4)}`,
            pointsBalance: 100,
        },
    });

    await prisma.pointsTransaction.create({
        data: {
            userId: user.id,
            type: 'reward',
            amount: 100,
            balanceAfter: 100,
            description: '新用户注册赠送',
        },
    });

    if (data.inviteCode) {
        const inviter = await prisma.user.findUnique({ where: { id: data.inviteCode } });
        if (inviter) {
            const rewardPoints = 30;
            await prisma.user.update({
                where: { id: inviter.id },
                data: { pointsBalance: { increment: rewardPoints } },
            });
            await prisma.pointsTransaction.create({
                data: {
                    userId: inviter.id,
                    type: 'reward',
                    amount: rewardPoints,
                    balanceAfter: inviter.pointsBalance + rewardPoints,
                    description: '邀请好友注册奖励',
                },
            });
            await prisma.user.update({
                where: { id: user.id },
                data: { pointsBalance: { increment: rewardPoints } },
            });
            await prisma.pointsTransaction.create({
                data: {
                    userId: user.id,
                    type: 'reward',
                    amount: rewardPoints,
                    balanceAfter: 100 + rewardPoints,
                    description: '受邀注册奖励',
                },
            });
            await prisma.invitation.create({
                data: { inviterId: inviter.id, inviteeId: user.id, rewardPoints },
            });
        }
    }

    const token = signToken(user.id);

    res.status(201).json({
        success: true,
        data: {
            token,
            user: {
                id: user.id,
                phone: user.phone,
                nickname: user.nickname,
                avatar: user.avatar,
                pointsBalance: user.pointsBalance,
            },
        },
    });
});

// 登录
router.post('/login', async (req: Request, res: Response) => {
    const data = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { phone: data.phone } });
    if (!user) throw new AppError('手机号未注册', 400);

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) throw new AppError('密码错误', 400);

    const token = signToken(user.id);

    res.json({
        success: true,
        data: {
            token,
            user: {
                id: user.id,
                phone: user.phone,
                nickname: user.nickname,
                avatar: user.avatar,
                pointsBalance: user.pointsBalance,
            },
        },
    });
});

// 获取当前用户信息
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, phone: true, nickname: true, avatar: true, pointsBalance: true, createdAt: true },
    });
    if (!user) throw new AppError('用户不存在', 404);
    res.json({ success: true, data: user });
});

export default router;
