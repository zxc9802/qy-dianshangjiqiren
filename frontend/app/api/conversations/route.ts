import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getUserId, errorResponse } from '../../lib/auth';
import { prisma, withPrismaRetry } from '../../lib/prisma';
import {
    createConversationSnapshotInput,
    getConversationBotPayload,
    resolveConversationBotTarget,
} from '../../lib/server-conversations';

function serializeConversationSummary(conversation: {
    id: string;
    title: string;
    isFavorited: boolean;
    createdAt: Date;
    updatedAt: Date;
    botId: string | null;
    customBotId: string | null;
    botKindSnapshot: string;
    botRouteIdSnapshot: string;
    botRefIdSnapshot: string;
    botNameSnapshot: string;
    botIconSnapshot: string;
    botCategorySnapshot: string;
    pointsPerUseSnapshot: number;
    bot?: {
        id: string;
        name: string;
        icon: string;
        category: string;
        pointsPerUse: number;
        sortOrder: number;
        isActive: boolean;
    } | null;
    customBot?: {
        id: string;
        name: string;
        avatar: string;
        icon: string;
        pointsPerUse: number;
        isActive: boolean;
    } | null;
    messages: Array<{ id: string; role: string; content: string; createdAt: Date }>;
    _count: { messages: number };
}) {
    const bot = getConversationBotPayload(conversation);

    return {
        id: conversation.id,
        botId: bot.routeId,
        title: conversation.title,
        isFavorited: conversation.isFavorited,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
        bot,
        messageCount: conversation._count.messages,
        messages: conversation.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt.toISOString(),
        })),
    };
}

export async function GET(req: NextRequest) {
    try {
        const userId = await getUserId(req);
        const { searchParams } = new URL(req.url);
        const botId = searchParams.get('botId');
        const favorited = searchParams.get('favorited');
        const page = Number(searchParams.get('page') || '1');
        const limit = Number(searchParams.get('limit') || '20');
        const skip = (page - 1) * limit;

        const where: {
            userId: string;
            botRouteIdSnapshot?: string;
            isFavorited?: boolean;
        } = { userId };

        if (botId) where.botRouteIdSnapshot = botId;
        if (favorited === 'true') where.isFavorited = true;

        const [conversations, total] = await withPrismaRetry(async (client) => Promise.all([
            client.conversation.findMany({
                where,
                include: {
                    bot: {
                        select: {
                            id: true,
                            name: true,
                            icon: true,
                            category: true,
                            pointsPerUse: true,
                            sortOrder: true,
                            isActive: true,
                        },
                    },
                    customBot: {
                        select: {
                            id: true,
                            name: true,
                            avatar: true,
                            icon: true,
                            pointsPerUse: true,
                            isActive: true,
                        },
                    },
                    messages: {
                        take: 1,
                        orderBy: { createdAt: 'desc' },
                        select: { id: true, role: true, content: true, createdAt: true },
                    },
                    _count: { select: { messages: true } },
                },
                orderBy: { updatedAt: 'desc' },
                skip,
                take: limit,
            }),
            client.conversation.count({ where }),
        ]));

        return Response.json({
            success: true,
            data: {
                conversations: conversations.map(serializeConversationSummary),
                total,
                page,
                limit,
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const userId = await getUserId(req);
        const { botId } = z.object({ botId: z.string().min(1) }).parse(await req.json());
        const target = await resolveConversationBotTarget(userId, botId);

        const conversation = await prisma.conversation.create({
            data: {
                userId,
                title: `与 ${target.name} 的对话`,
                ...createConversationSnapshotInput(target),
            },
            include: {
                bot: {
                    select: {
                        id: true,
                        name: true,
                        icon: true,
                        category: true,
                        pointsPerUse: true,
                        sortOrder: true,
                        isActive: true,
                    },
                },
                customBot: {
                    select: {
                        id: true,
                        name: true,
                        avatar: true,
                        icon: true,
                        pointsPerUse: true,
                        isActive: true,
                    },
                },
                messages: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    select: { id: true, role: true, content: true, createdAt: true },
                },
                _count: { select: { messages: true } },
            },
        });

        return Response.json({ success: true, data: serializeConversationSummary(conversation) }, { status: 201 });
    } catch (error) {
        return errorResponse(error);
    }
}
