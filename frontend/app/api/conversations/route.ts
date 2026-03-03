import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../lib/auth';

export async function GET(req: NextRequest) {
    try {
        const userId = getUserId(req);
        const { searchParams } = new URL(req.url);
        const botId = searchParams.get('botId');
        const favorited = searchParams.get('favorited');
        const page = Number(searchParams.get('page') || '1');
        const limit = Number(searchParams.get('limit') || '20');
        const skip = (page - 1) * limit;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: any = { userId };
        if (botId) where.botId = botId;
        if (favorited === 'true') where.isFavorited = true;

        const [conversations, total] = await Promise.all([
            prisma.conversation.findMany({
                where,
                include: {
                    bot: { select: { name: true, icon: true, category: true } },
                    messages: { take: 1, orderBy: { createdAt: 'desc' }, select: { content: true, createdAt: true } },
                },
                orderBy: { updatedAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.conversation.count({ where }),
        ]);

        return Response.json({ success: true, data: { conversations, total, page, limit } });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function POST(req: NextRequest) {
    try {
        const userId = getUserId(req);
        const { botId } = z.object({ botId: z.string().uuid() }).parse(await req.json());

        const bot = await prisma.bot.findUnique({ where: { id: botId } });
        if (!bot) throw new AppError('智能体不存在', 404);

        const conversation = await prisma.conversation.create({
            data: { userId, botId, title: `与${bot.name}的对话` },
            include: { bot: { select: { name: true, icon: true, category: true } } },
        });

        return Response.json({ success: true, data: conversation }, { status: 201 });
    } catch (err) {
        return errorResponse(err);
    }
}
