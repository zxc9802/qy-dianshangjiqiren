import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../../../lib/auth';
import {
    buildAttachmentContextBlock,
    buildMessageDisplayContent,
    buildMessagePromptText,
    getDefaultAttachmentPrompt,
    normalizeAttachmentRecord,
    serializeAttachmentMetadata,
    stripAttachmentDisplayLabels,
    type ChatAttachmentUpload,
} from '../../../../lib/chat-attachments';
import {
    buildConversationImageSummary,
    encodeConversationImageMessage,
    isConversationImageTurn,
} from '../../../../lib/conversation-message-codec';
import { buildPromptWithBuiltinKnowledge } from '../../../../lib/builtin-knowledge';
import { DEFAULT_RESPONSE_MODEL } from '../../../../lib/chat-models';
import { getSystemPromptBySortOrder, isPlaceholderPrompt } from '../../../../lib/systemPrompts';
import { buildConversationTitle, getConversationBotPayload } from '../../../../lib/server-conversations';
import { deleteTempVideo, loadTempVideo } from '../../../../lib/server-chat-video';
import { requestYunwuOpenAIChat, type OpenAIChatMessage } from '../../../../lib/yunwu-openai-chat';
import {
    streamYunwuGeminiChat,
    type GeminiChatMessage,
    type GeminiChatPart,
} from '../../../../lib/yunwu-gemini-chat';
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

const attachmentSchema = z.object({
    kind: z.enum(['document', 'image', 'video']),
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().nonnegative().max(100 * 1024 * 1024),
    mimeType: z.string().max(255).optional(),
    extractedText: z.string().default(''),
    previewUrl: z.string().max(2048).optional(),
    durationMs: z.number().int().nonnegative().optional(),
    transcript: z.string().optional(),
    frames: z.array(z.object({
        url: z.string().min(1).max(2048),
        timestampMs: z.number().int().nonnegative(),
    })).max(6).optional(),
    tempVideoToken: z.string().max(255).optional(),
});

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
            suggestions = Array.isArray(parsed.suggestions)
                ? parsed.suggestions.filter((item): item is string => typeof item === 'string')
                : [];
        } catch {
            suggestions = [];
        }
    }

    return { suggestions, cleanResponse };
}

function normalizeIncomingAttachments(input: z.infer<typeof attachmentSchema>[]): ChatAttachmentUpload[] {
    return input.map((attachment) => ({
        kind: attachment.kind,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
        extractedText: attachment.extractedText.trim(),
        previewUrl: attachment.previewUrl,
        durationMs: attachment.durationMs,
        transcript: attachment.transcript?.trim(),
        frames: attachment.frames?.map((frame) => ({
            url: frame.url,
            timestampMs: frame.timestampMs,
        })) || [],
        tempVideoToken: attachment.tempVideoToken,
    }));
}

function buildStoredMessagePromptText(message: {
    content: string;
    attachments: Array<{
        fileName: string;
        fileSize: number;
        fileType: string;
        fileUrl: string;
        parsedText: string | null;
    }>;
}): string {
    const attachments = message.attachments.map((attachment) => normalizeAttachmentRecord(attachment));
    const baseText = attachments.length
        ? stripAttachmentDisplayLabels(message.content, attachments)
        : message.content.trim();

    return attachments.length
        ? buildMessagePromptText(baseText, attachments)
        : baseText;
}

function buildGeminiCurrentTurnKnowledgeText(
    rawText: string,
    attachments: ChatAttachmentUpload[],
): string {
    if (attachments.length === 0) {
        return rawText.trim();
    }

    return rawText.trim() || getDefaultAttachmentPrompt(attachments);
}

async function buildGeminiCurrentTurnMessage(
    rawText: string,
    attachments: ChatAttachmentUpload[],
): Promise<GeminiChatMessage> {
    if (attachments.length === 0) {
        return { role: 'user', content: rawText.trim() };
    }

    const parts: GeminiChatPart[] = [];
    const questionText = rawText.trim() || 'Analyze the uploaded attachments and provide a structured answer.';

    for (const attachment of attachments) {
        if (attachment.kind === 'video' && attachment.tempVideoToken) {
            const tempVideo = await loadTempVideo(attachment.tempVideoToken);
            parts.push({
                text: `User uploaded a video attachment named ${attachment.fileName}. Inspect the video directly and answer from the video itself.`,
            });
            parts.push({
                inlineData: {
                    mimeType: tempVideo.mimeType || attachment.mimeType || 'video/mp4',
                    data: tempVideo.buffer.toString('base64'),
                },
            });
            continue;
        }

        parts.push({
            text: buildAttachmentContextBlock(attachment),
        });
    }

    parts.push({
        text: `User question:\n${questionText}`,
    });

    return {
        role: 'user',
        content: parts,
    };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    let tempVideoTokensToCleanup: string[] = [];

    try {
        const userId = await getUserId(req);
        const { id: conversationId } = await params;
        const {
            content,
            displayContent,
            inputType,
            aspectRatio,
            responseModel,
            attachments: incomingAttachments,
        } = z.object({
            content: z.string().default(''),
            displayContent: z.string().optional(),
            inputType: z.enum(['text', 'voice', 'file', 'image', 'video']).default('text'),
            aspectRatio: z.string().min(3).max(10).optional(),
            responseModel: z.enum(['gemini', 'gpt-5.4']).default(DEFAULT_RESPONSE_MODEL),
            attachments: z.array(attachmentSchema).max(10).default([]),
        }).parse(await req.json());

        const attachments = normalizeIncomingAttachments(incomingAttachments);
        const hasAttachmentPayload = attachments.length > 0;
        tempVideoTokensToCleanup = attachments
            .filter((attachment) => attachment.kind === 'video' && attachment.tempVideoToken)
            .map((attachment) => attachment.tempVideoToken as string);

        if (!content.trim() && !hasAttachmentPayload && inputType !== 'image') {
            throw new AppError('content or attachments is required', 400);
        }

        if (inputType === 'image' && attachments.length > 0) {
            throw new AppError('Image generation requests do not accept uploaded attachments.', 400);
        }

        if (attachments.filter((attachment) => attachment.kind === 'video').length > 1) {
            throw new AppError('Each message currently supports only one uploaded video.', 400);
        }

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
                messages: {
                    orderBy: { createdAt: 'asc' },
                    include: {
                        attachments: {
                            select: {
                                fileName: true,
                                fileSize: true,
                                fileType: true,
                                fileUrl: true,
                                parsedText: true,
                            },
                        },
                    },
                },
            },
        });

        if (!conversation) {
            throw new AppError('Conversation not found', 404);
        }

        const bot = getConversationBotPayload(conversation);
        const userDisplayContent = typeof displayContent === 'string' && displayContent.trim()
            ? displayContent.trim()
            : hasAttachmentPayload
                ? buildMessageDisplayContent(content, attachments)
                : content.trim();
        const currentPromptText = hasAttachmentPayload
            ? buildMessagePromptText(content, attachments)
            : content.trim();
        const geminiCurrentTurnKnowledgeText = buildGeminiCurrentTurnKnowledgeText(content, attachments);

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
                    ...conversation.messages
                        .filter((message) => !isConversationImageTurn({ content: message.content, inputType: message.inputType }))
                        .map((message) => ({
                            role: message.role,
                            content: buildStoredMessagePromptText(message),
                        })),
                    {
                        role: 'user',
                        content: responseModel === 'gemini'
                            ? geminiCurrentTurnKnowledgeText
                            : currentPromptText,
                    },
                ],
            );
            const rules = conversation.bot.sortOrder >= 15 && conversation.bot.sortOrder <= 22
                ? XHS_GLOBAL_RULES
                : GLOBAL_RULES;
            systemPrompt = `${knowledgePrompt}\n\n${rules}`.trim();

            // Inject knowledge documents uploaded by admin for this preset bot
            const presetDocs = await prisma.presetBotDocument.findMany({
                where: { botId: conversation.bot.id },
                select: { fileName: true, parsedText: true },
                orderBy: { createdAt: 'asc' },
            });
            if (presetDocs.length > 0) {
                const presetKnowledge = presetDocs
                    .map((doc) => `### ${doc.fileName}\n${doc.parsedText}`)
                    .join('\n\n---\n\n');
                systemPrompt = `${systemPrompt}\n\n# 管理员知识库\n以下是管理员上传的参考资料，请在回答时参考：\n\n${presetKnowledge}`;
            }
        }

        const userMessage = await prisma.message.create({
            data: {
                conversationId,
                role: 'user',
                content: userDisplayContent,
                inputType,
            },
        });

        if (attachments.length > 0) {
            await prisma.attachment.createMany({
                data: attachments.map((attachment) => ({
                    messageId: userMessage.id,
                    fileType: attachment.mimeType || attachment.kind,
                    fileUrl: attachment.previewUrl || attachment.frames?.[0]?.url || '',
                    fileName: attachment.fileName,
                    fileSize: attachment.fileSize,
                    parsedText: serializeAttachmentMetadata(attachment),
                })),
            });
        }

        const historyMessages: OpenAIChatMessage[] = conversation.messages
            .filter((message) => !isConversationImageTurn({ content: message.content, inputType: message.inputType }))
            .map((message) => ({
                role: message.role === 'assistant' ? 'assistant' : 'user',
                content: buildStoredMessagePromptText(message),
            }));

        const shouldSetInitialTitle = !conversation.messages.some((message) => message.role === 'user');

        if (inputType !== 'image' && responseModel === 'gpt-5.4') {
            const fullResponse = await requestYunwuOpenAIChat({
                systemPrompt,
                messages: [
                    ...historyMessages,
                    { role: 'user', content: currentPromptText },
                ],
                temperature: 0.8,
                maxTokens: 8192,
            });

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
                            ? buildConversationTitle(bot.name, [{ role: 'user', content: userDisplayContent }])
                            : conversation.title,
                        updatedAt: new Date(),
                    },
                });
            });

            await Promise.all(tempVideoTokensToCleanup.map((token) => deleteTempVideo(token)));

            return Response.json({
                success: true,
                data: {
                    kind: 'text',
                    content: cleanResponse,
                    suggestions,
                },
            });
        }

        const encoder = new TextEncoder();

        const stream = new ReadableStream({
            async start(controller) {
                let fullResponse = '';
                let streamedVisibleLength = 0;

                try {
                    if (inputType === 'image') {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: 'status',
                            content: 'Generating image. This usually takes 10 to 40 seconds.',
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
                                || 'Image generation failed',
                            );
                        }

                        const generated = imagePayload.data as {
                            prompt: string;
                            aspectRatio: string;
                            errorMessage: string | null;
                            resultImagePaths: string[];
                        } | undefined;

                        if (!generated?.resultImagePaths?.length) {
                            throw new Error(generated?.errorMessage || 'Image generation failed');
                        }

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: 'status',
                            content: 'Image generated. Finalizing result.',
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
                                        ? buildConversationTitle(bot.name, [{ role: 'user', content: userDisplayContent }])
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

                    const flushVisibleText = () => {
                        const visibleResponse = stripSuggestionBlock(fullResponse);
                        if (visibleResponse.length <= streamedVisibleLength) {
                            return;
                        }

                        const visibleDelta = visibleResponse.slice(streamedVisibleLength);
                        streamedVisibleLength = visibleResponse.length;
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: visibleDelta })}\n\n`));
                    };

                    const geminiMessages: GeminiChatMessage[] = historyMessages.map((message) => ({
                        role: message.role,
                        content: typeof message.content === 'string' ? message.content : '',
                    }));
                    geminiMessages.push(await buildGeminiCurrentTurnMessage(content, attachments));

                    await streamYunwuGeminiChat({
                        systemPrompt,
                        messages: geminiMessages,
                        temperature: 0.8,
                        topP: 0.95,
                        maxOutputTokens: 8192,
                        onText: (textChunk) => {
                            if (!textChunk) {
                                return;
                            }

                            fullResponse += textChunk;
                            flushVisibleText();
                        },
                    });

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
                                    ? buildConversationTitle(bot.name, [{ role: 'user', content: userDisplayContent }])
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
                    await Promise.all(tempVideoTokensToCleanup.map((token) => deleteTempVideo(token)));
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
        await Promise.all(tempVideoTokensToCleanup.map((token) => deleteTempVideo(token)));
        return errorResponse(error);
    }
}
