import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { readServerEnv } from '../../../../lib/server-env';
import { getUserId, AppError, errorResponse } from '../../../../lib/auth';
import { getSystemPromptBySortOrder, isPlaceholderPrompt } from '../../../../lib/systemPrompts';
import { buildConversationTitle, getConversationBotPayload } from '../../../../lib/server-conversations';

const GLOBAL_RULES = `
# Global interaction rules

1. The user can end discovery early. If they ask for the answer directly, provide it based on current context and mark assumptions when needed.
2. End every reply with a JSON suggestions block:
\`\`\`json
{"suggestions":["Option A","Option B","Option C","Give me the answer directly"]}
\`\`\`
3. Keep the answer structured, concise, and practical.
`;

const XHS_GLOBAL_RULES = `${GLOBAL_RULES}\n4. XiaoHongShu related bots may use a small amount of emoji when appropriate.`;

const SUGGESTION_BLOCK_PATTERN = /```json[\s\S]*?(\{"suggestions":\s*\[[\s\S]*?\]\})[\s\S]*?```/;

function stripSuggestionBlock(text: string): string {
    return text
        .replace(/```json[\s\S]*?\{"suggestions":\s*\[[\s\S]*?\}[\s\S]*?```/g, '')
        .replace(/\n?```json[\s\S]*$/g, '')
        .trimEnd();
}

function extractSuggestions(text: string): { suggestions: string[]; cleanResponse: string } {
    const suggestionMatch = text.match(SUGGESTION_BLOCK_PATTERN);
    let suggestions: string[] = [];
    let cleanResponse = stripSuggestionBlock(text).trim();

    if (suggestionMatch) {
        try {
            const parsed = JSON.parse(suggestionMatch[1]);
            suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
        } catch {
            suggestions = [];
        }
    }

    return { suggestions, cleanResponse };
}

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
        const userId = await getUserId(req);
        const { id: conversationId } = await params;
        const { content, displayContent, inputType } = z.object({
            content: z.string().min(1),
            displayContent: z.string().optional(),
            inputType: z.enum(['text', 'voice', 'file']).default('text'),
        }).parse(await req.json());

        const conversation = await prisma.conversation.findFirst({
            where: { id: conversationId, userId },
            include: {
                bot: true,
                customBot: {
                    include: {
                        documents: {
                            select: { fileName: true, parsedText: true },
                            orderBy: { createdAt: 'asc' },
                        },
                    },
                },
                messages: { orderBy: { createdAt: 'asc' } },
            },
        });

        if (!conversation) {
            throw new AppError('Conversation not found', 404);
        }

        const bot = getConversationBotPayload(conversation);
        let systemPrompt = '';

        if (bot.kind === 'custom') {
            if (!conversation.customBot || !conversation.customBot.isActive) {
                throw new AppError('Custom bot is no longer available', 410);
            }

            systemPrompt = conversation.customBot.systemPrompt || `You are ${bot.name}. Provide structured, practical guidance.`;

            if (conversation.customBot.documents.length > 0) {
                const knowledgeText = conversation.customBot.documents
                    .map((document) => `### ${document.fileName}\n${document.parsedText}`)
                    .join('\n\n---\n\n');
                systemPrompt = `${systemPrompt}\n\n# Knowledge Base\nUse the following user-uploaded context when answering:\n\n${knowledgeText}`;
            }

            systemPrompt = `${systemPrompt}\n\n${GLOBAL_RULES}`.trim();
        } else {
            if (!conversation.bot || !conversation.bot.isActive) {
                throw new AppError('Bot is no longer available', 410);
            }

            const fallbackPrompt = `You are ${conversation.bot.name}. Provide structured, practical guidance.`;
            const basePrompt = isPlaceholderPrompt(conversation.bot.systemPrompt)
                ? getSystemPromptBySortOrder(conversation.bot.sortOrder, fallbackPrompt)
                : conversation.bot.systemPrompt;
            const rules = conversation.bot.sortOrder >= 15 && conversation.bot.sortOrder <= 22
                ? XHS_GLOBAL_RULES
                : GLOBAL_RULES;
            systemPrompt = `${basePrompt}\n\n${rules}`.trim();
        }

        await prisma.message.create({
            data: {
                conversationId,
                role: 'user',
                content: displayContent || content,
                inputType,
            },
        });

        const apiMessages = conversation.messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
        }));
        apiMessages.push({ role: 'user', parts: [{ text: content }] });

        const apiUrl = normalizeStreamUrl(readServerEnv('YUNWU_CHAT_API_URL') || readServerEnv('AI_API_URL'));
        const apiKey = readServerEnv('YUNWU_CHAT_API_KEY') || readServerEnv('AI_API_KEY');
        const encoder = new TextEncoder();

        const shouldSetInitialTitle = !conversation.messages.some((message) => message.role === 'user');

        const stream = new ReadableStream({
            async start(controller) {
                let fullResponse = '';
                let streamedVisibleLength = 0;
                try {
                    const upstream = await fetch(apiUrl, {
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

                    if (!upstream.ok || !upstream.body) {
                        throw new Error(`AI API error: ${upstream.status}`);
                    }

                    const reader = upstream.body.getReader();
                    const decoder = new TextDecoder();

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        const chunk = decoder.decode(value, { stream: true });
                        for (const line of chunk.split('\n')) {
                            const trimmed = line.trim();
                            if (!trimmed.startsWith('data:')) continue;

                            const payload = trimmed.slice(5).trim();
                            if (!payload || payload === '[DONE]') continue;

                            let data: {
                                candidates?: Array<{
                                    content?: {
                                        parts?: Array<{ text?: string }>;
                                    };
                                }>;
                            };
                            try {
                                data = JSON.parse(payload) as {
                                    candidates?: Array<{
                                        content?: {
                                            parts?: Array<{ text?: string }>;
                                        };
                                    }>;
                                };
                            } catch {
                                continue;
                            }

                            const text = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || '';
                            if (!text) continue;

                            fullResponse += text;
                            const visibleResponse = stripSuggestionBlock(fullResponse);
                            if (visibleResponse.length <= streamedVisibleLength) continue;

                            const visibleDelta = visibleResponse.slice(streamedVisibleLength);
                            streamedVisibleLength = visibleResponse.length;
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: visibleDelta })}\n\n`));
                        }
                    }

                    const { suggestions, cleanResponse } = extractSuggestions(fullResponse);

                    await prisma.$transaction(async (tx) => {
                        await tx.message.create({
                            data: {
                                conversationId,
                                role: 'assistant',
                                content: cleanResponse,
                                suggestions: suggestions.length ? JSON.stringify(suggestions) : null,
                            },
                        });

                        await tx.conversation.update({
                            where: { id: conversationId },
                            data: {
                                title: shouldSetInitialTitle
                                    ? buildConversationTitle(bot.name, [{ role: 'user', content: displayContent || content }])
                                    : conversation.title,
                                updatedAt: new Date(),
                            },
                        });
                    });

                    if (suggestions.length) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'suggestions', content: suggestions })}\n\n`));
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
                } catch (error) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: error instanceof Error ? error.message : 'Request failed' })}\n\n`));
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}
