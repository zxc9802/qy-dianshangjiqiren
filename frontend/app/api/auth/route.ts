import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { signToken, AppError, errorResponse } from '../../lib/auth';
import { generateCode, sendVerificationEmail } from '../../lib/email';

const sendCodeSchema = z.object({ email: z.string().email('请输入有效的邮箱地址') });

const verifyCodeSchema = z.object({
    email: z.string().email(),
    code: z.string().length(6, '验证码为6位'),
});

const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6, '密码至少6位'),
    code: z.string().length(6, '验证码为6位'),
    nickname: z.string().optional(),
    inviteCode: z.string().optional(),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

export async function POST(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const action = url.searchParams.get('action');
        const body = await req.json();

        switch (action) {
            case 'send-code':
                return handleSendCode(body);
            case 'verify-code':
                return handleVerifyCode(body);
            case 'register':
                return handleRegister(body);
            case 'login':
                return handleLogin(body);
            default:
                return Response.json({ error: '无效的操作' }, { status: 400 });
        }
    } catch (err) {
        return errorResponse(err);
    }
}

async function handleSendCode(body: unknown) {
    const { email } = sendCodeSchema.parse(body);

    const recent = await prisma.verificationCode.findFirst({
        where: { email, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent) throw new AppError('发送太频繁，请60秒后再试', 429);

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60_000);

    await prisma.verificationCode.create({ data: { email, code, expiresAt } });
    await sendVerificationEmail(email, code);

    return Response.json({ success: true, message: '验证码已发送' });
}

async function handleVerifyCode(body: unknown) {
    const { email, code } = verifyCodeSchema.parse(body);

    const record = await prisma.verificationCode.findFirst({
        where: { email, code, used: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new AppError('验证码无效或已过期');

    return Response.json({ success: true, message: '验证码正确' });
}

async function handleRegister(body: unknown) {
    const data = registerSchema.parse(body);

    const codeRecord = await prisma.verificationCode.findFirst({
        where: { email: data.email, code: data.code, used: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
    });
    if (!codeRecord) throw new AppError('验证码无效或已过期');

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new AppError('该邮箱已注册');

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

    await prisma.verificationCode.update({
        where: { id: codeRecord.id },
        data: { used: true },
    });

    await prisma.pointsTransaction.create({
        data: { userId: user.id, type: 'reward', amount: 100, balanceAfter: 100, description: '新用户注册赠送' },
    });

    if (data.inviteCode) {
        const inviter = await prisma.user.findUnique({ where: { id: data.inviteCode } });
        if (inviter) {
            const reward = 30;
            await prisma.user.update({ where: { id: inviter.id }, data: { pointsBalance: { increment: reward } } });
            await prisma.pointsTransaction.create({
                data: { userId: inviter.id, type: 'reward', amount: reward, balanceAfter: inviter.pointsBalance + reward, description: '邀请好友注册奖励' },
            });
            await prisma.user.update({ where: { id: user.id }, data: { pointsBalance: { increment: reward } } });
            await prisma.pointsTransaction.create({
                data: { userId: user.id, type: 'reward', amount: reward, balanceAfter: 100 + reward, description: '受邀注册奖励' },
            });
            await prisma.invitation.create({ data: { inviterId: inviter.id, inviteeId: user.id, rewardPoints: reward } });
        }
    }

    const token = signToken(user.id);
    return Response.json({
        success: true,
        data: { token, user: { id: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar, pointsBalance: user.pointsBalance } },
    }, { status: 201 });
}

async function handleLogin(body: unknown) {
    const data = loginSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) throw new AppError('邮箱未注册');

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) throw new AppError('密码错误');

    const token = signToken(user.id);
    return Response.json({
        success: true,
        data: { token, user: { id: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar, pointsBalance: user.pointsBalance } },
    });
}
