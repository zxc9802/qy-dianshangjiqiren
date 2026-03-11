import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getUserId, errorResponse } from '../../../lib/auth';
import { DEFAULT_RESPONSE_MODEL } from '../../../lib/chat-models';
import {
    buildExtensionContents,
    resolveExtensionBot,
    streamExtensionCompletion,
} from '../../../lib/extension-chat';

const pageContextSchema = z.object({
    title: z.string(),
    url: z.string(),
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
});

export async function POST(req: NextRequest) {
    try {
        const userId = await getUserId(req);
        const { botId, mode, messages, pageContext, responseModel } = z.object({
            botId: z.string().min(1),
            mode: z.enum(['summary', 'chat']).default('chat'),
            messages: z.array(chatMessageSchema).default([]),
            pageContext: pageContextSchema.optional(),
            responseModel: z.enum(['gemini', 'gpt-5.4']).default(DEFAULT_RESPONSE_MODEL),
        }).parse(await req.json());

        const { bot, systemPrompt } = await resolveExtensionBot(
            userId,
            botId,
            mode === 'chat' ? messages : [],
        );
        const contents = buildExtensionContents(mode, messages, pageContext);

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    await streamExtensionCompletion(systemPrompt, contents, (text) => {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`));
                    }, responseModel);
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', bot })}\n\n`));
                } catch (err) {
                    const message = err instanceof Error ? err.message : '未知错误';
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: message })}\n\n`));
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            },
        });
    } catch (err) {
        return errorResponse(err);
    }
}
