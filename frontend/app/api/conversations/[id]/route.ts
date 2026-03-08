import { NextRequest } from 'next/server';
import { getUserId, AppError, errorResponse } from '../../../lib/auth';
import { prisma, withPrismaRetry } from '../../../lib/prisma';
import { getConversationBotPayload } from '../../../lib/server-conversations';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = await getUserId(req);
        const { id } = await params;

        const conversation = await withPrismaRetry((client) => client.conversation.findFirst({
            where: { id, userId },
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
                messages: { orderBy: { createdAt: 'asc' }, include: { attachments: true } },
            },
        }));

        if (!conversation) {
            throw new AppError('Conversation not found', 404);
        }

        const bot = getConversationBotPayload(conversation);

        return Response.json({
            success: true,
            data: {
                id: conversation.id,
                botId: bot.routeId,
                title: conversation.title,
                isFavorited: conversation.isFavorited,
                createdAt: conversation.createdAt.toISOString(),
                updatedAt: conversation.updatedAt.toISOString(),
                bot,
                messageCount: conversation.messages.length,
                messages: conversation.messages.map((message) => ({
                    id: message.id,
                    role: message.role,
                    content: message.content,
                    inputType: message.inputType,
                    suggestions: message.suggestions,
                    createdAt: message.createdAt.toISOString(),
                    attachments: message.attachments.map((attachment) => ({
                        id: attachment.id,
                        fileType: attachment.fileType,
                        fileUrl: attachment.fileUrl,
                        fileName: attachment.fileName,
                        fileSize: attachment.fileSize,
                    })),
                })),
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = await getUserId(req);
        const { id } = await params;

        const conversation = await prisma.conversation.findFirst({ where: { id, userId } });
        if (!conversation) {
            throw new AppError('Conversation not found', 404);
        }

        await prisma.conversation.delete({ where: { id: conversation.id } });
        return Response.json({ success: true, message: 'Conversation deleted' });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = await getUserId(req);
        const { id } = await params;

        const conversation = await prisma.conversation.findFirst({ where: { id, userId } });
        if (!conversation) {
            throw new AppError('Conversation not found', 404);
        }

        const updated = await prisma.conversation.update({
            where: { id: conversation.id },
            data: { isFavorited: !conversation.isFavorited },
        });

        return Response.json({ success: true, data: { isFavorited: updated.isFavorited } });
    } catch (error) {
        return errorResponse(error);
    }
}
