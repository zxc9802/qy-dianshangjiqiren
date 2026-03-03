import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { AppError, errorResponse } from '../../../lib/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const bot = await prisma.bot.findUnique({
            where: { id },
            select: { id: true, name: true, slug: true, category: true, icon: true, description: true, pointsPerUse: true },
        });
        if (!bot) throw new AppError('智能体不存在', 404);
        return Response.json({ success: true, data: bot });
    } catch (err) {
        return errorResponse(err);
    }
}
