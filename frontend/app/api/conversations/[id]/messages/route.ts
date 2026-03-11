import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../../../lib/auth';
import {
    buildConversationImageSummary,
    encodeConversationImageMessage,
    isConversationImageTurn,
} from '../../../../lib/conversation-message-codec';
import { buildPromptWithBuiltinKnowledge } from '../../../../lib/builtin-knowledge';
import { DEFAULT_RESPONSE_MODEL } from '../../../../lib/chat-models';
import { getSystemPromptBySortOrder, isPlaceholderPrompt } from '../../../../lib/systemPrompts';
import { buildConversationTitle, getConversationBotPayload } from '../../../../lib/server-conversations';
import { streamYunwuOpenAIChat, type OpenAIChatMessage } from '../../../../lib/yunwu-openai-chat';
import { streamYunwuGeminiChat } from '../../../../lib/yunwu-gemini-chat';
import { generateImageViaBackend } from '../../../image-generations/proxy';

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
    const cleanResponse = stripSuggestionBlock(text).trim();

    if (suggestionMatch) {
        try {
            const parsed = JSON.parse(suggestionMatch[1]) as { suggestions?: unknown };
            suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((item): item is string => typeof item === 'string') : [];
        } catch {
            suggestions = [];
        }
    }

    return { suggestions, cleanResponse };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = await getUserId(req);
        const { id: conversationId } = await params;
        const { content, displayContent, inputType, aspectRatio, responseModel } = z.object({
            content: z.string().min(1),
            displayContent: z.string().optional(),
            inputType: z.enum(['text', 'voice', 'file', 'image']).default('text'),
            aspectRatio: z.string().min(3).max(10).optional(),
            responseModel: z.enum(['gemini', 'gpt-5.4']).default(DEFAULT_RESPONSE_MODEL),
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
            const knowledgePrompt = buildPromptWithBuiltinKnowledge(
                bot.routeId,
                basePrompt,
                [
                    ...conversation.messages.map((message) => ({
                        role: message.role,
                        content: message.content,
                    })),
                    { role: 'user', content },
                ],
            );
            const rules = conversation.bot.sortOrder >= 15 && conversation.bot.sortOrder <= 22
                ? XHS_GLOBAL_RULES
                : GLOBAL_RULES;
            systemPrompt = `${knowledgePrompt}\n\n${rules}`.trim();
        }

        await prisma.message.create({
            data: {
                conversationId,
                role: 'user',
                content: displayContent || content,
                inputType,
            },
        });

        const apiMessages: OpenAIChatMessage[] = conversation.messages
            .filter((message) => !isConversationImageTurn({ content: message.content, inputType: message.inputType }))
            .map((message) => ({
                role: message.role === 'assistant' ? 'assistant' : 'user',
                content: message.content,
            }));
        apiMessages.push({ role: 'user', content });
        const encoder = new TextEncoder();
        const shouldSetInitialTitle = !conversation.messages.some((message) => message.role === 'user');

        const stream = new ReadableStream({
            async start(controller) {
                let fullResponse = '';
                let streamedVisibleLength = 0;

                try {
                    if (inputType === 'image') {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: 'status',
                            content: '正在调用图片模型，通常需要 10 到 40 秒。',
                        })}\n\n`));

                        const imageResponse = await generateImageViaBackend(req.headers, {
                            prompt: content,
                            aspectRatio: aspectRatio || '1:1',
                            count: 1,
                        });

                        const imagePayload = imageResponse.payload as Record<string, unknown>;
                        if (!imageResponse.ok) {
                            throw new Error(
                                (typeof imagePayload.error === 'string' ? imagePayload.error : '')
                                || (typeof imagePayload.message === 'string' ? imagePayload.message : '')
                                || '图片生成失败',
                            );
                        }

                        const generated = imagePayload.data as {
                            prompt: string;
                            aspectRatio: string;
                            errorMessage: string | null;
                            resultImagePaths: string[];
                        } | undefined;

                        if (!generated?.resultImagePaths?.length) {
                            throw new Error(generated?.errorMessage || '图片生成失败');
                        }

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: 'status',
                            content: '图片已生成，正在整理结果。',
                        })}\n\n`));

                        const assistantText = buildConversationImageSummary(generated.resultImagePaths.length);
                        const encodedAssistantMessage = encodeConversationImageMessage({
                            content: assistantText,
                            imageUrls: generated.resultImagePaths,
                            imagePrompt: generated.prompt,
                            aspectRatio: generated.aspectRatio,
                        });

                        await prisma.$transaction(async (tx) => {
                            await tx.message.create({
                                data: {
                                    conversationId,
                                    role: 'assistant',
                                    content: encodedAssistantMessage,
                                    inputType: 'image',
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

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: 'image',
                            content: {
                                content: assistantText,
                                kind: 'image',
                                imageUrls: generated.resultImagePaths,
                                imagePrompt: generated.prompt,
                                aspectRatio: generated.aspectRatio,
                            },
                        })}\n\n`));
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
                        return;
                    }

                    const handleStreamText = (text: string) => {
                        if (!text) return;

                        fullResponse += text;
                        const visibleResponse = stripSuggestionBlock(fullResponse);
                        if (visibleResponse.length <= streamedVisibleLength) return;

                        const visibleDelta = visibleResponse.slice(streamedVisibleLength);
                        streamedVisibleLength = visibleResponse.length;
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: visibleDelta })}\n\n`));
                    };

                    if (responseModel === 'gpt-5.4') {
                        await streamYunwuOpenAIChat({
                            systemPrompt,
                            messages: apiMessages,
                            temperature: 0.8,
                            maxTokens: 8192,
                            onText: handleStreamText,
                        });
                    } else {
                        await streamYunwuGeminiChat({
                            systemPrompt,
                            messages: apiMessages.map((message) => ({
                                role: message.role,
                                content: typeof message.content === 'string' ? message.content : '',
                            })),
                            temperature: 0.8,
                            topP: 0.95,
                            maxOutputTokens: 8192,
                            onText: handleStreamText,
                        });
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
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: 'error',
                        content: error instanceof Error ? error.message : 'Request failed',
                    })}\n\n`));
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
