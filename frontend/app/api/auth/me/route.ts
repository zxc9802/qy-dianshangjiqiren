import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../../lib/auth';

export async function GET(req: NextRequest) {
    try {
        const userId = getUserId(req);
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, nickname: true, avatar: true, pointsBalance: true, createdAt: true },
        });
        if (!user) throw new AppError('用户不存在', 404);
        return Response.json({ success: true, data: user });
    } catch (err) {
        return errorResponse(err);
    }
}
