import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/error';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { generateCode, sendVerificationEmail } from '../utils/email';
import { z } from 'zod';

const router = Router();

const emailSchema = z.string().email('请输入有效的邮箱地址');

const sendCodeSchema = z.object({
    email: emailSchema,
});

const verifyCodeSchema = z.object({
    email: emailSchema,
    code: z.string().length(6, '验证码为6位'),
});

const registerSchema = z.object({
    email: emailSchema,
    password: z.string().min(6, '密码至少6位'),
    code: z.string().length(6, '验证码为6位'),
    nickname: z.string().optional(),
    inviteCode: z.string().optional(),
});

const loginSchema = z.object({
    email: emailSchema,
    password: z.string(),
});

function signToken(userId: string): string {
    return jwt.sign(
        { userId },
        process.env.JWT_SECRET || 'fallback-secret',
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as jwt.SignOptions
    );
}

// 发送验证码
router.post('/send-code', async (req: Request, res: Response) => {
    const { email } = sendCodeSchema.parse(req.body);

    // 限频：同一邮箱 60 秒内只能发一次
    const recent = await prisma.verificationCode.findFirst({
        where: {
            email,
            createdAt: { gt: new Date(Date.now() - 60_000) },
        },
    });
    if (recent) throw new AppError('发送太频繁，请60秒后再试', 429);

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60_000); // 5 分钟后过期

    await prisma.verificationCode.create({
        data: { email, code, expiresAt },
    });

    await sendVerificationEmail(email, code);

    res.json({ success: true, message: '验证码已发送' });
});

// 验证验证码
router.post('/verify-code', async (req: Request, res: Response) => {
    const { email, code } = verifyCodeSchema.parse(req.body);

    const record = await prisma.verificationCode.findFirst({
        where: {
            email,
            code,
            used: false,
            expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
    });

    if (!record) throw new AppError('验证码无效或已过期', 400);

    res.json({ success: true, message: '验证码正确' });
});

// 注册
router.post('/register', async (req: Request, res: Response) => {
    const data = registerSchema.parse(req.body);

    // 验证验证码
    const codeRecord = await prisma.verificationCode.findFirst({
        where: {
            email: data.email,
            code: data.code,
            used: false,
            expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
    });
    if (!codeRecord) throw new AppError('验证码无效或已过期', 400);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new AppError('该邮箱已注册', 400);

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
        data: {
            email: data.email,
            passwordHash,
            isVerified: true,
            nickname: data.nickname || `用户${data.email.split('@')[0].slice(0, 6)}`,
            pointsBalance: 100,
        },
    });

    // 标记验证码已使用
    await prisma.verificationCode.update({
        where: { id: codeRecord.id },
        data: { used: true },
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
                email: user.email,
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

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) throw new AppError('邮箱未注册', 400);

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) throw new AppError('密码错误', 400);

    const token = signToken(user.id);

    res.json({
        success: true,
        data: {
            token,
            user: {
                id: user.id,
                email: user.email,
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
        select: { id: true, email: true, nickname: true, avatar: true, pointsBalance: true, createdAt: true },
    });
    if (!user) throw new AppError('用户不存在', 404);
    res.json({ success: true, data: user });
});

export default router;
