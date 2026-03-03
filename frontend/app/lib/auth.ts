import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { readServerEnv } from './server-env';

const JWT_SECRET = readServerEnv('JWT_SECRET') || 'fallback-secret';
const JWT_EXPIRES_IN = readServerEnv('JWT_EXPIRES_IN') || '7d';

export function signToken(userId: string): string {
    return jwt.sign(
        { userId },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );
}

export function getUserId(req: NextRequest): string {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        throw new AuthError('未登录，请先登录');
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        return decoded.userId;
    } catch {
        throw new AuthError('登录已过期，请重新登录');
    }
}

export class AuthError extends Error {
    status: number;
    constructor(message: string, status = 401) {
        super(message);
        this.status = status;
        this.name = 'AuthError';
    }
}

export class AppError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
        this.name = 'AppError';
    }
}

export function errorResponse(err: unknown) {
    if (err instanceof AuthError) {
        return Response.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof AppError) {
        return Response.json({ error: err.message }, { status: err.status });
    }
    // Zod validation error
    if (err && typeof err === 'object' && 'issues' in err) {
        const firstIssue = (err as { issues: { message: string }[] }).issues[0];
        return Response.json({ error: firstIssue?.message || '参数错误' }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : '服务器错误';
    console.error('[API Error]', msg);
    return Response.json({ error: msg }, { status: 500 });
}
