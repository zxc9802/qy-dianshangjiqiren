import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getUserId, AppError, errorResponse } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import { requestYunwuGeminiChat } from '../../../../lib/yunwu-gemini-chat';

const requestSchema = z.object({
    messageText: z.string().trim().min(1).max(4000),
    latestVideo: z.object({
        videoLabel: z.string().max(32).optional(),
        fileName: z.string().min(1).max(255),
        extractedText: z.string().max(4000).optional(),
        transcript: z.string().max(4000).optional(),
    }).optional(),
    recentMessages: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(3000),
    })).max(6).default([]),
});

type VideoIntentDecision = {
    shouldInspectVideo: boolean;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
};

function parseDecision(text: string): VideoIntentDecision {
    const fallback: VideoIntentDecision = {
        shouldInspectVideo: false,
        confidence: 'low',
        reason: 'Classifier returned an invalid response.',
    };

    if (!text.trim()) {
        return fallback;
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        return fallback;
    }

    try {
        const parsed = JSON.parse(jsonMatch[0]) as Partial<VideoIntentDecision>;
        return {
            shouldInspectVideo: parsed.shouldInspectVideo === true,
            confidence: parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
                ? parsed.confidence
                : 'low',
            reason: typeof parsed.reason === 'string' && parsed.reason.trim()
                ? parsed.reason.trim().slice(0, 240)
                : fallback.reason,
        };
    } catch {
        return fallback;
    }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = await getUserId(req);
        const { id } = await params;
        const payload = requestSchema.parse(await req.json());

        const conversation = await prisma.conversation.findFirst({
            where: { id, userId },
            select: { id: true },
        });

        if (!conversation) {
            throw new AppError('Conversation not found', 404);
        }

        const latestVideoContext = payload.latestVideo
            ? [
                `Latest video label: ${payload.latestVideo.videoLabel || 'N/A'}`,
                `Latest video file name: ${payload.latestVideo.fileName}`,
                payload.latestVideo.extractedText ? `Latest video extracted text:\n${payload.latestVideo.extractedText}` : '',
                payload.latestVideo.transcript ? `Latest video transcript:\n${payload.latestVideo.transcript}` : '',
            ].filter(Boolean).join('\n\n')
            : 'No reusable latest video metadata is available.';

        const recentMessagesContext = payload.recentMessages.length > 0
            ? payload.recentMessages
                .map((message, index) => `${index + 1}. ${message.role}: ${message.content}`)
                .join('\n\n')
            : 'No recent messages.';

        const responseText = await requestYunwuGeminiChat({
            systemPrompt: [
                'You are a strict classifier for a chat product.',
                'Decide whether the assistant must inspect the raw video again for the user\'s next reply.',
                'Return strict JSON only: {"shouldInspectVideo":boolean,"confidence":"high|medium|low","reason":"..."}',
                'Set shouldInspectVideo=true when the user is asking about video-specific evidence or wants fresh analysis of the actual video, such as shots, visuals, subtitles, audio, pacing, scenes, editing, comparisons involving the video itself, or direct optimization of the actual video.',
                'Set shouldInspectVideo=false when the user is only asking to rewrite, summarize, expand, reformat, compare, or derive copy from the existing text discussion or the previous assistant answer, without needing to inspect the raw video again.',
                'If uncertain, prefer false.',
            ].join('\n'),
            messages: [
                {
                    role: 'user',
                    content: [
                        `Recent conversation:\n${recentMessagesContext}`,
                        latestVideoContext,
                        `Current user message:\n${payload.messageText}`,
                    ].join('\n\n'),
                },
            ],
            temperature: 0.1,
            topP: 0.8,
            maxOutputTokens: 180,
        });

        return Response.json({
            success: true,
            data: parseDecision(responseText),
        });
    } catch (error) {
        return errorResponse(error);
    }
}
