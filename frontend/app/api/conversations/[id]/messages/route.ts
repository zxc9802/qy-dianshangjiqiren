import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { readServerEnv } from '../../../../lib/server-env';
import { getUserId, AppError, errorResponse } from '../../../../lib/auth';
import { getSystemPromptBySortOrder, isPlaceholderPrompt } from '../../../../lib/systemPrompts';

function normalizeStreamUrl(rawUrl?: string): string {
    let url = (rawUrl || 'https://yunwu.ai/v1beta/models/gemini-3-flash-preview:streamGenerateContent').trim();
    url = url.replace(':generateContent', ':streamGenerateContent');
    if (!/[?&]alt=sse(?:&|$)/.test(url)) {
        url += url.includes('?') ? '&alt=sse' : '?alt=sse';
    }
    return url;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = getUserId(req);
        const { id: convId } = await params;
        const { content, inputType } = z.object({
            content: z.string().min(1),
            inputType: z.enum(['text', 'voice', 'file']).default('text'),
        }).parse(await req.json());

        const conversation = await prisma.conversation.findFirst({
            where: { id: convId, userId },
            include: { bot: true, messages: { orderBy: { createdAt: 'asc' } } },
        });
        if (!conversation) throw new AppError('对话不存在', 404);

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.pointsBalance < conversation.bot.pointsPerUse) {
            throw new AppError('积分不足，请先充值', 402);
        }

        await prisma.message.create({
            data: { conversationId: convId, role: 'user', content, inputType },
        });

        const apiMessages = conversation.messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));
        apiMessages.push({ role: 'user', parts: [{ text: content }] });

        const apiUrl = normalizeStreamUrl(readServerEnv('AI_API_URL'));
        const apiKey = readServerEnv('AI_API_KEY');
        const fallbackPrompt = `你是${conversation.bot.name}，请给出专业、结构化、可执行的建议。`;
        const systemPrompt = isPlaceholderPrompt(conversation.bot.systemPrompt)
            ? getSystemPromptBySortOrder(conversation.bot.sortOrder, fallbackPrompt)
            : conversation.bot.systemPrompt;

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                let fullResponse = '';
                try {
                    const apiResponse = await fetch(apiUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${apiKey}`,
                        },
                        body: JSON.stringify({
                            contents: apiMessages,
                            systemInstruction: { parts: [{ text: systemPrompt }] },
                            generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 8192 },
                        }),
                    });

                    if (!apiResponse.ok || !apiResponse.body) {
                        throw new Error(`AI API error: ${apiResponse.status}`);
                    }

                    const reader = apiResponse.body.getReader();
                    const decoder = new TextDecoder();

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        const chunk = decoder.decode(value, { stream: true });
                        for (const line of chunk.split('\n')) {
                            if (!line.startsWith('data: ')) continue;
                            const jsonStr = line.slice(6).trim();
                            if (jsonStr === '[DONE]') continue;
                            try {
                                const data = JSON.parse(jsonStr);
                                const parts = data?.candidates?.[0]?.content?.parts;
                                if (Array.isArray(parts)) {
                                    for (const part of parts) {
                                        if (part?.text && !part?.thought) {
                                            fullResponse += part.text;
                                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: part.text })}\n\n`));
                                        }
                                    }
                                }
                            } catch { /* skip */ }
                        }
                    }

                    // Extract suggestions
                    let suggestions: string | null = null;
                    const match = fullResponse.match(/```json\s*(\{"suggestions":\s*\[[\s\S]*?\]\})\s*```/);
                    if (match) {
                        suggestions = match[1];
                        fullResponse = fullResponse.replace(match[0], '').trim();
                    }

                    // Save AI reply
                    await prisma.message.create({
                        data: { conversationId: convId, role: 'assistant', content: fullResponse, suggestions },
                    });

                    // Deduct points
                    const pointsCost = conversation.bot.pointsPerUse;
                    await prisma.user.update({
                        where: { id: userId },
                        data: { pointsBalance: { decrement: pointsCost } },
                    });
                    await prisma.pointsTransaction.create({
                        data: {
                            userId,
                            type: 'consume',
                            amount: -pointsCost,
                            balanceAfter: user!.pointsBalance - pointsCost,
                            description: `使用${conversation.bot.name}`,
                            relatedConversationId: convId,
                        },
                    });

                    await prisma.conversation.update({
                        where: { id: convId },
                        data: { updatedAt: new Date() },
                    });

                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'suggestions', content: suggestions })}\n\n`));
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', pointsUsed: pointsCost })}\n\n`));
                } catch (error) {
                    const errMsg = error instanceof Error ? error.message : '未知错误';
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: errMsg })}\n\n`));
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
