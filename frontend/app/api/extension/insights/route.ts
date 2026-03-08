import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { getUserId, errorResponse } from '../../../lib/auth';
import { normalizePageInsightRecord } from '../../../lib/page-insights';

const pageContextSchema = z.object({
    title: z.string(),
    url: z.string().min(1),
    domain: z.string(),
    mainText: z.string(),
    metaDescription: z.string(),
    selectedText: z.string(),
    hasVideo: z.boolean(),
    videoTitle: z.string(),
    videoDescription: z.string(),
    captionsText: z.string(),
    transcriptSource: z.enum(['dom', 'track', 'page', 'none']),
});

const chatMessageSchema = z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    createdAt: z.string().optional(),
});

export async function POST(req: NextRequest) {
    try {
        const userId = await getUserId(req);
        const payload = z.object({
            pageContext: pageContextSchema,
            summary: z.string().trim().optional(),
            chatTranscript: z.array(chatMessageSchema).default([]),
            botId: z.string().min(1),
            botKind: z.enum(['builtin', 'custom']),
            botName: z.string().min(1),
        }).parse(await req.json());

        const insight = await prisma.pageInsight.create({
            data: {
                userId,
                sourceUrl: payload.pageContext.url,
                sourceTitle: payload.pageContext.title,
                sourceDomain: payload.pageContext.domain,
                pageContextJson: payload.pageContext,
                summary: payload.summary || null,
                chatTranscriptJson: payload.chatTranscript,
                botId: payload.botId,
                botKind: payload.botKind,
                botName: payload.botName,
            },
        });

        return Response.json({
            success: true,
            data: normalizePageInsightRecord(insight),
        }, { status: 201 });
    } catch (err) {
        return errorResponse(err);
    }
}
