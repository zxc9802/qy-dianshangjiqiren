import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { getUserId, errorResponse } from '../../../lib/auth';
import { BUILTIN_BOTS } from '../../../lib/builtin-bots';

export async function GET(req: NextRequest) {
    try {
        const userId = await getUserId(req);

        const builtinBots = BUILTIN_BOTS.map((bot) => ({
            botId: bot.routeId,
            kind: 'builtin' as const,
            name: bot.name,
            description: bot.description,
            icon: bot.icon,
            category: bot.category,
            pointsPerUse: bot.pointsPerUse,
        }));

        const customBots = await prisma.customBot.findMany({
            where: {
                userId,
                isActive: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
            select: {
                id: true,
                name: true,
                description: true,
                avatar: true,
                icon: true,
                pointsPerUse: true,
            },
        });

        const normalizedCustomBots = customBots.map((bot) => ({
            botId: `custom-${bot.id}`,
            kind: 'custom' as const,
            name: bot.name,
            description: bot.description,
            icon: bot.avatar || bot.icon || 'bot',
            category: '我的智能体',
            pointsPerUse: bot.pointsPerUse,
        }));

        return Response.json({
            success: true,
            data: {
                builtinBots,
                customBots: normalizedCustomBots,
                bots: [...builtinBots, ...normalizedCustomBots],
            },
        });
    } catch (err) {
        return errorResponse(err);
    }
}
