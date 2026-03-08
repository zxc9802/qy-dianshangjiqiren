import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { getUserId, errorResponse } from '../../../lib/auth';
import {
    buildConversationTitle,
    createConversationSnapshotInput,
    resolveConversationBotTarget,
} from '../../../lib/server-conversations';
import { serializeSimpleWorkflow } from '../../../lib/workflow-simple';

const localConversationMessageSchema = z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    timestamp: z.number().optional(),
});

const localConversationSchema = z.object({
    id: z.string(),
    botId: z.string(),
    botName: z.string().optional().default(''),
    messages: z.array(localConversationMessageSchema).default([]),
    isFavorite: z.boolean().optional().default(false),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
});

const localWorkflowSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional().default(''),
    steps: z.array(z.object({
        botId: z.string(),
        botName: z.string(),
    })).default([]),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
});

function mergeLocalConversations(
    history: z.infer<typeof localConversationSchema>[],
    favorites: z.infer<typeof localConversationSchema>[],
) {
    const merged = new Map<string, z.infer<typeof localConversationSchema>>();

    for (const item of [...history, ...favorites]) {
        const existing = merged.get(item.id);
        const normalized = {
            ...item,
            botName: item.botName || existing?.botName || '',
            messages: Array.isArray(item.messages) ? item.messages : [],
            isFavorite: (item.isFavorite ?? false) || (existing?.isFavorite ?? false),
            createdAt: item.createdAt ?? existing?.createdAt,
            updatedAt: item.updatedAt ?? existing?.updatedAt,
        };

        if (!existing) {
            merged.set(item.id, normalized);
            continue;
        }

        const preferred = normalized.messages.length > existing.messages.length
            || (
                normalized.messages.length === existing.messages.length
                && (normalized.updatedAt ?? 0) >= (existing.updatedAt ?? 0)
            )
            ? normalized
            : existing;

        merged.set(item.id, {
            ...preferred,
            isFavorite: normalized.isFavorite || existing.isFavorite,
        });
    }

    return [...merged.values()];
}

export async function POST(req: NextRequest) {
    try {
        const userId = await getUserId(req);
        const body = z.object({
            conversations: z.array(localConversationSchema).default([]),
            favorites: z.array(localConversationSchema).default([]),
            workflows: z.array(localWorkflowSchema).default([]),
        }).parse(await req.json());

        const mergedConversations = mergeLocalConversations(body.conversations, body.favorites);
        let migratedConversations = 0;
        for (const item of mergedConversations) {
            let snapshotInput;

            try {
                const target = await resolveConversationBotTarget(userId, item.botId);
                snapshotInput = createConversationSnapshotInput(target);
            } catch {
                const kind = item.botId.startsWith('custom-') ? 'custom' : 'builtin';
                snapshotInput = {
                    botId: null,
                    customBotId: null,
                    botKindSnapshot: kind,
                    botRouteIdSnapshot: item.botId,
                    botRefIdSnapshot: kind === 'custom' ? item.botId.slice('custom-'.length) : '',
                    botNameSnapshot: item.botName || '已删除智能体',
                    botIconSnapshot: '',
                    botCategorySnapshot: kind === 'custom' ? '我的智能体' : '',
                    pointsPerUseSnapshot: 0,
                };
            }

            const title = buildConversationTitle(
                snapshotInput.botNameSnapshot || item.botName || 'AI助手',
                item.messages,
            );

            const existing = await prisma.conversation.findFirst({
                where: { userId, clientSourceId: item.id },
                select: { id: true },
            });

            let conversationId = existing?.id;
            if (conversationId) {
                await prisma.conversation.update({
                    where: { id: conversationId },
                    data: {
                        ...snapshotInput,
                        title,
                        isFavorited: item.isFavorite,
                        createdAt: item.createdAt ? new Date(item.createdAt) : undefined,
                        updatedAt: item.updatedAt ? new Date(item.updatedAt) : undefined,
                    },
                });
                await prisma.message.deleteMany({ where: { conversationId } });
            } else {
                const created = await prisma.conversation.create({
                    data: {
                        userId,
                        clientSourceId: item.id,
                        title,
                        isFavorited: item.isFavorite,
                        createdAt: item.createdAt ? new Date(item.createdAt) : undefined,
                        updatedAt: item.updatedAt ? new Date(item.updatedAt) : undefined,
                        ...snapshotInput,
                    },
                    select: { id: true },
                });
                conversationId = created.id;
            }

            if (conversationId && item.messages.length > 0) {
                await prisma.message.createMany({
                    data: item.messages.map((message, index) => ({
                        conversationId,
                        role: message.role,
                        content: message.content,
                        inputType: 'text',
                        createdAt: message.timestamp
                            ? new Date(message.timestamp)
                            : new Date((item.createdAt ?? Date.now()) + index),
                    })),
                });
            }

            migratedConversations += 1;
        }

        let migratedWorkflows = 0;
        for (const workflow of body.workflows) {
            const canvasData = serializeSimpleWorkflow(workflow.steps);
            const existing = await prisma.workflow.findFirst({
                where: { userId, clientSourceId: workflow.id },
                select: { id: true },
            });

            if (existing) {
                await prisma.workflow.update({
                    where: { id: existing.id },
                    data: {
                        name: workflow.name,
                        description: workflow.description || '',
                        canvasData,
                        createdAt: workflow.createdAt ? new Date(workflow.createdAt) : undefined,
                        updatedAt: workflow.updatedAt ? new Date(workflow.updatedAt) : undefined,
                    },
                });
            } else {
                await prisma.workflow.create({
                    data: {
                        userId,
                        clientSourceId: workflow.id,
                        name: workflow.name,
                        description: workflow.description || '',
                        canvasData,
                        createdAt: workflow.createdAt ? new Date(workflow.createdAt) : undefined,
                        updatedAt: workflow.updatedAt ? new Date(workflow.updatedAt) : undefined,
                    },
                });
            }

            migratedWorkflows += 1;
        }

        return Response.json({
            success: true,
            data: {
                migratedConversations,
                migratedWorkflows,
            },
        });
    } catch (err) {
        return errorResponse(err);
    }
}
