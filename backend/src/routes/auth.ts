import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/error';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { generateCode, sendVerificationEmail } from '../utils/email';

const router = Router();

const emailSchema = z.string().email('Please enter a valid email address.');

const sendCodeSchema = z.object({
  email: emailSchema,
});

const verifyCodeSchema = z.object({
  email: emailSchema,
  code: z.string().length(6, 'Verification code must be 6 characters.'),
});

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  code: z.string().length(6, 'Verification code must be 6 characters.'),
  nickname: z.string().optional(),
  inviteCode: z.string().optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string(),
});

function signToken(userId: string): string {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new AppError('JWT_SECRET is not configured.', 500);
  }

  return jwt.sign(
    { userId },
    jwtSecret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as jwt.SignOptions,
  );
}

router.post('/send-code', async (req: Request, res: Response) => {
  const { email } = sendCodeSchema.parse(req.body);

  const recent = await prisma.verificationCode.findFirst({
    where: {
      email,
      createdAt: { gt: new Date(Date.now() - 60_000) },
    },
  });

  if (recent) {
    throw new AppError('Verification code was sent too recently. Please try again in 60 seconds.', 429);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 5 * 60_000);

  await prisma.verificationCode.create({
    data: { email, code, expiresAt },
  });

  await sendVerificationEmail(email, code);

  res.json({ success: true, message: 'Verification code sent.' });
});

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

  if (!record) {
    throw new AppError('Verification code is invalid or expired.', 400);
  }

  res.json({ success: true, message: 'Verification code verified.' });
});

router.post('/register', async (req: Request, res: Response) => {
  const data = registerSchema.parse(req.body);

  const codeRecord = await prisma.verificationCode.findFirst({
    where: {
      email: data.email,
      code: data.code,
      used: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!codeRecord) {
    throw new AppError('Verification code is invalid or expired.', 400);
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new AppError('This email has already been registered.', 400);
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      isVerified: true,
      nickname: data.nickname || `User${data.email.split('@')[0].slice(0, 6)}` ,
    },
  });

  await prisma.verificationCode.update({
    where: { id: codeRecord.id },
    data: { used: true },
  });

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
      },
    },
  });
});

router.post('/login', async (req: Request, res: Response) => {
  const data = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) {
    throw new AppError('Account not found.', 400);
  }

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) {
    throw new AppError('Incorrect password.', 400);
  }

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
      },
    },
  });
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, nickname: true, avatar: true, createdAt: true },
  });

  if (!user) {
    throw new AppError('User not found.', 404);
  }

  res.json({ success: true, data: user });
});

export default router;