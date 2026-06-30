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
    parseConversationImageMessage,
} from '../../../../lib/conversation-message-codec';
import { buildPromptWithBuiltinKnowledge } from '../../../../lib/builtin-knowledge';
import { VIDEO_BREAKDOWN_BOT_ID } from '../../../../lib/builtin-bots';
import {
    DEFAULT_RESPONSE_MODEL,
    DEFAULT_WEB_SEARCH_MODE,
    RESPONSE_MODEL_VALUES,
    WEB_SEARCH_MODE_VALUES,
} from '../../../../lib/chat-models';
import {
    extractSuggestions as extractSharedSuggestions,
    stripSuggestionBlock as stripSharedSuggestionBlock,
} from '../../../../lib/formatMessage';
import { streamGeminiDeepThinkingChat } from '../../../../lib/gemini-deep-chat';
import { getSystemPromptBySortOrder, isPlaceholderPrompt } from '../../../../lib/systemPrompts';
import { buildConversationTitle, getConversationBotPayload } from '../../../../lib/server-conversations';
import { deleteTempVideo, downloadRemoteVideo, loadTempVideo } from '../../../../lib/server-chat-video';
import { buildLongTermMemoryPrompt, rememberConversationTurn } from '../../../../lib/server-memory';
import {
    streamYunwuOpenAIChat,
    type OpenAIChatMessage,
} from '../../../../lib/yunwu-openai-chat';
import { streamYunwuClaudeChat } from '../../../../lib/yunwu-claude-chat';
import {
    streamYunwuGeminiChat,
    type GeminiChatMessage,
    type GeminiChatPart,
} from '../../../../lib/yunwu-gemini-chat';
import { generateImageViaBackend } from '../../../image-generations/proxy';
import { enrichSystemPromptWithWebSearch } from '../../../../lib/web-search';
import {
    buildImageGenerationPrompt,
    selectImageReferenceForPrompt,
} from '../../../../lib/image-generation-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
const STREAM_HEARTBEAT_INTERVAL_MS = 15000;
const VIDEO_BREAKDOWN_HISTORY_TURNS = 10;
const VIDEO_BREAKDOWN_STREAM_STATUS = '正在分析视频内容，请稍候...';
const attachmentSchema = z.object({
    kind: z.enum(['document', 'image', 'video']),
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().nonnegative(),
    mimeType: z.string().max(255).optional(),
    extractedText: z.string().default(''),
    previewUrl: z.string().max(2048).optional(),
    durationMs: z.number().int().nonnegative().optional(),
    transcript: z.string().optional(),
    clientVideoId: z.string().max(255).optional(),
    videoLabel: z.string().max(32).optional(),
    source: z.enum(['current', 'history']).optional(),
    remoteVideoUrl: z.string().url().max(4096).optional(),
    remotePlatform: z.enum(['youtube', 'douyin', 'tiktok', 'generic']).optional(),
    downloadMethod: z.enum(['direct', 'douyin-parser', 'tiktok-playwright', 'yt-dlp']).optional(),
    frames: z.array(z.object({
        url: z.string().min(1).max(2048),
        timestampMs: z.number().int().nonnegative(),
    })).max(6).optional(),
    tempVideoToken: z.string().max(255).optional(),
});
const messageRequestSchema = z.object({
    content: z.string().default(''),
    displayContent: z.string().optional(),
    inputType: z.enum(['text', 'voice', 'file', 'image', 'video']).default('text'),
    aspectRatio: z.string().min(3).max(10).optional(),
    responseModel: z.enum(RESPONSE_MODEL_VALUES).default(DEFAULT_RESPONSE_MODEL),
    webSearchMode: z.enum(WEB_SEARCH_MODE_VALUES).default(DEFAULT_WEB_SEARCH_MODE),
    attachments: z.array(attachmentSchema).max(10).default([]),
});

interface InlineVideoUpload {
    fileName: string;
    mimeType: string;
    data: string;
}

interface CurrentTurnAttachment extends ChatAttachmentUpload {
    inlineVideoData?: InlineVideoUpload;
}

function isMissingPresetBotDocumentTable(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return /preset_bot_documents/i.test(message)
        || /presetBotDocument/i.test(message)
        || /does not exist in the current database/i.test(message)
        || /P2021/i.test(message);
}

async function loadPresetBotDocuments(botId: string): Promise<Array<{ fileName: string; parsedText: string }>> {
    try {
        return await prisma.presetBotDocument.findMany({
            where: { botId },
            select: { fileName: true, parsedText: true },
            orderBy: { createdAt: 'asc' },
        });
    } catch (error) {
        if (isMissingPresetBotDocumentTable(error)) {
            console.warn('[Conversations] preset_bot_documents table is missing, skip preset knowledge injection.');
            return [];
        }

        throw error;
    }
}

function stripSuggestionBlock(text: string): string {
    return stripSharedSuggestionBlock(text);
}

function extractSuggestions(text: string): { suggestions: string[]; cleanResponse: string } {
    const cleanResponse = stripSuggestionBlock(text).trim();
    return {
        suggestions: extractSharedSuggestions(text),
        cleanResponse,
    };
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
        clientVideoId: attachment.clientVideoId?.trim(),
        videoLabel: attachment.videoLabel?.trim(),
        source: attachment.source,
        remoteVideoUrl: attachment.remoteVideoUrl?.trim(),
        remotePlatform: attachment.remotePlatform,
        downloadMethod: attachment.downloadMethod,
        frames: attachment.frames?.map((frame) => ({
            url: frame.url,
            timestampMs: frame.timestampMs,
        })) || [],
        tempVideoToken: attachment.tempVideoToken,
    }));
}

async function parseMessageRequest(req: NextRequest): Promise<z.infer<typeof messageRequestSchema> & {
    inlineVideoUploads: InlineVideoUpload[];
}> {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.toLowerCase().includes('multipart/form-data')) {
        const formData = await req.formData();
        const rawPayload = formData.get('payload');
        if (typeof rawPayload !== 'string' || !rawPayload.trim()) {
            throw new AppError('payload is required', 400);
        }

        let payload: unknown;
        try {
            payload = JSON.parse(rawPayload);
        } catch {
            throw new AppError('Invalid payload JSON', 400);
        }

        const parsed = messageRequestSchema.parse(payload);
        const inlineVideoUploads = await Promise.all(
            formData
                .getAll('videoFiles')
                .filter((item): item is File => item instanceof File)
                .map(async (file) => ({
                    fileName: file.name,
                    mimeType: file.type || 'video/mp4',
                    data: Buffer.from(await file.arrayBuffer()).toString('base64'),
                })),
        );

        return {
            ...parsed,
            inlineVideoUploads,
        };
    }

    return {
        ...messageRequestSchema.parse(await req.json()),
        inlineVideoUploads: [],
    };
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
}, options?: {
    excludeVideoAttachments?: boolean;
}): string {
    const allAttachments = message.attachments.map((attachment) => normalizeAttachmentRecord(attachment));
    const baseText = allAttachments.length
        ? stripAttachmentDisplayLabels(message.content, allAttachments)
        : message.content.trim();
    const attachments = options?.excludeVideoAttachments
        ? allAttachments.filter((attachment) => attachment.kind !== 'video')
        : allAttachments;

    return attachments.length
        ? buildMessagePromptText(baseText, attachments)
        : baseText;
}

function buildGeminiCurrentTurnKnowledgeText(
    rawText: string,
    attachments: CurrentTurnAttachment[],
): string {
    if (attachments.length === 0) {
        return rawText.trim();
    }

    return rawText.trim() || getDefaultAttachmentPrompt(attachments);
}

async function buildGeminiCurrentTurnMessage(
    rawText: string,
    attachments: CurrentTurnAttachment[],
): Promise<GeminiChatMessage> {
    if (attachments.length === 0) {
        return { role: 'user', content: rawText.trim() };
    }

    const parts: GeminiChatPart[] = [];
    const questionText = rawText.trim() || 'Analyze the uploaded attachments and provide a structured answer.';

    for (const attachment of attachments) {
        const attachmentDescriptor = attachment.videoLabel
            ? `${attachment.videoLabel} (${attachment.fileName})`
            : attachment.fileName;
        const videoInstruction = attachment.source === 'history'
            ? `User referenced a previously uploaded video attachment named ${attachmentDescriptor}. Inspect this video directly and answer from the video itself.`
            : `User uploaded a video attachment named ${attachmentDescriptor}. Inspect the video directly and answer from the video itself.`;

        if (attachment.kind === 'video' && attachment.inlineVideoData) {
            parts.push({
                text: videoInstruction,
            });
            parts.push({
                inlineData: {
                    mimeType: attachment.inlineVideoData.mimeType || attachment.mimeType || 'video/mp4',
                    data: attachment.inlineVideoData.data,
                },
            });
            continue;
        }

        if (attachment.kind === 'video' && attachment.tempVideoToken) {
            const tempVideo = await loadTempVideo(attachment.tempVideoToken);
            parts.push({
                text: videoInstruction,
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

function takeRecentUserTurns<T extends { role: string }>(
    messages: T[],
    maxUserTurns: number,
): T[] {
    if (maxUserTurns <= 0) {
        return [];
    }

    let includedUserTurns = 0;
    let startIndex = messages.length;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        startIndex = index;

        if (messages[index].role === 'user') {
            includedUserTurns += 1;
            if (includedUserTurns >= maxUserTurns) {
                break;
            }
        }
    }

    if (includedUserTurns < maxUserTurns) {
        return messages;
    }

    return messages.slice(startIndex);
}

function resolveRequestUrl(req: NextRequest, value: string): string {
    if (/^https?:\/\//i.test(value)) return value;
    return new URL(value, req.nextUrl.origin).toString();
}

function mimeTypeFromImageUrl(value: string): string {
    const pathname = (() => {
        try {
            return new URL(value, 'https://local.invalid').pathname.toLowerCase();
        } catch {
            return value.toLowerCase();
        }
    })();

    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
    if (pathname.endsWith('.webp')) return 'image/webp';
    return 'image/png';
}

async function loadImageReference(req: NextRequest, imageUrl: string): Promise<{ mimeType: string; base64: string }> {
    const resolvedUrl = resolveRequestUrl(req, imageUrl);
    const response = await fetch(resolvedUrl, { cache: 'no-store' });
    if (!response.ok) {
        throw new AppError('无法读取历史参考图，请重新生成或明确指定另一张图片。', 502);
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
    const mimeType = contentType?.startsWith('image/')
        ? contentType
        : mimeTypeFromImageUrl(resolvedUrl);
    const base64 = Buffer.from(await response.arrayBuffer()).toString('base64');
    return { mimeType, base64 };
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
            webSearchMode,
            attachments: incomingAttachments,
            inlineVideoUploads,
        } = await parseMessageRequest(req);

        const normalizedAttachments = normalizeIncomingAttachments(incomingAttachments);
        let inlineVideoIndex = 0;
        const attachments: CurrentTurnAttachment[] = await Promise.all(normalizedAttachments.map(async (attachment) => {
            if (attachment.kind !== 'video') {
                return attachment;
            }

            if (attachment.remoteVideoUrl) {
                const remoteVideo = await downloadRemoteVideo(attachment.remoteVideoUrl, {
                    preprocess: responseModel !== 'gemini',
                });
                return {
                    ...attachment,
                    fileName: attachment.fileName || remoteVideo.fileName,
                    fileSize: attachment.fileSize > 0 ? attachment.fileSize : remoteVideo.fileSize,
                    mimeType: attachment.mimeType || remoteVideo.mimeType,
                    extractedText: attachment.extractedText || remoteVideo.extractedText,
                    previewUrl: attachment.previewUrl || remoteVideo.previewUrl,
                    durationMs: attachment.durationMs ?? remoteVideo.durationMs,
                    transcript: attachment.transcript || remoteVideo.transcript,
                    frames: attachment.frames?.length ? attachment.frames : remoteVideo.frames,
                    remotePlatform: remoteVideo.remotePlatform,
                    downloadMethod: remoteVideo.downloadMethod,
                    inlineVideoData: {
                        fileName: remoteVideo.fileName,
                        mimeType: remoteVideo.mimeType,
                        data: remoteVideo.buffer.toString('base64'),
                    },
                };
            }

            const inlineVideoData = inlineVideoUploads[inlineVideoIndex];
            inlineVideoIndex += 1;

            if (!inlineVideoData) {
                return attachment;
            }

            return {
                ...attachment,
                inlineVideoData,
            };
        }));
        const hasAttachmentPayload = attachments.length > 0;
        tempVideoTokensToCleanup = attachments
            .filter((attachment) => attachment.kind === 'video' && attachment.tempVideoToken)
            .map((attachment) => attachment.tempVideoToken as string);
        const unresolvedGeminiVideos = attachments.filter((attachment) => attachment.kind === 'video' && !attachment.inlineVideoData && !attachment.tempVideoToken).length;
        if (responseModel === 'gemini' && unresolvedGeminiVideos > 0) {
            throw new AppError('Gemini 未收到当前视频文件，请重新上传后重试。', 400);
        }

        if (!content.trim() && !hasAttachmentPayload && inputType !== 'image') {
            throw new AppError('content or attachments is required', 400);
        }

        if (inputType === 'image' && attachments.length > 0) {
            throw new AppError('Image generation requests do not accept uploaded attachments.', 400);
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
        const isVideoBreakdownBot = bot.kind === 'builtin'
            && bot.routeId === VIDEO_BREAKDOWN_BOT_ID;
        const excludeHistoricalVideoAttachments = isVideoBreakdownBot;
        const filteredConversationMessages = conversation.messages
            .filter((message) => !isConversationImageTurn({ content: message.content, inputType: message.inputType }));
        const contextConversationMessages = isVideoBreakdownBot
            ? takeRecentUserTurns(filteredConversationMessages, VIDEO_BREAKDOWN_HISTORY_TURNS)
            : filteredConversationMessages;
        const buildHistoryPromptText = (message: {
            content: string;
            attachments: Array<{
                fileName: string;
                fileSize: number;
                fileType: string;
                fileUrl: string;
                parsedText: string | null;
            }>;
        }): string => buildStoredMessagePromptText(message, {
            excludeVideoAttachments: excludeHistoricalVideoAttachments,
        });
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
                    ...contextConversationMessages
                        .map((message) => ({
                            role: message.role,
                            content: buildHistoryPromptText(message),
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
            const presetDocs = await loadPresetBotDocuments(conversation.bot.id);
            if (presetDocs.length > 0) {
                const presetKnowledge = presetDocs
                    .map((doc) => `### ${doc.fileName}\n${doc.parsedText}`)
                    .join('\n\n---\n\n');
                systemPrompt = `${systemPrompt}\n\n# 管理员知识库\n以下是管理员上传的参考资料，请在回答时参考：\n\n${presetKnowledge}`;
            }
        }

        if (inputType !== 'image') {
            const memoryPrompt = await buildLongTermMemoryPrompt({
                userId,
                botRouteId: bot.routeId,
                query: currentPromptText,
            });
            if (memoryPrompt) {
                systemPrompt = `${systemPrompt}\n\n${memoryPrompt}`.trim();
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

        const historyMessages: OpenAIChatMessage[] = contextConversationMessages
            .map((message) => ({
                role: message.role === 'assistant' ? 'assistant' : 'user',
                content: buildHistoryPromptText(message),
            }));

        const shouldSetInitialTitle = !conversation.messages.some((message) => message.role === 'user');
        const shouldStreamOpenAI = inputType !== 'image' && responseModel === 'gpt-5.4';
        const shouldStreamClaude = inputType !== 'image' && responseModel === 'claude-opus-4.6';
        const shouldStreamVideoBreakdownGpt = shouldStreamOpenAI
            && bot.kind === 'builtin'
            && bot.routeId === VIDEO_BREAKDOWN_BOT_ID
            && (inputType === 'video' || attachments.some((attachment) => attachment.kind === 'video'));

        const encoder = new TextEncoder();

        const stream = new ReadableStream({
            async start(controller) {
                let fullResponse = '';
                let streamedVisibleLength = 0;
                let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

                const startHeartbeat = () => {
                    if (!shouldStreamVideoBreakdownGpt || heartbeatTimer) {
                        return;
                    }

                    heartbeatTimer = setInterval(() => {
                        try {
                            controller.enqueue(encoder.encode(': keep-alive\n\n'));
                        } catch {
                            // Ignore heartbeat enqueue errors during shutdown.
                        }
                    }, STREAM_HEARTBEAT_INTERVAL_MS);
                };

                const stopHeartbeat = () => {
                    if (heartbeatTimer) {
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    }
                };

                try {
                    if (inputType === 'image') {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: 'status',
                            content: '正在生成图片，通常需要 10 到 40 秒。',
                        })}\n\n`));

                        const imagePrompt = buildImageGenerationPrompt({
                            currentPrompt: content,
                            historyMessages: historyMessages.map((message) => ({
                                role: message.role,
                                content: typeof message.content === 'string' ? message.content : '',
                            })),
                        });
                        const imageReference = selectImageReferenceForPrompt({
                            currentPrompt: content,
                            historyMessages: conversation.messages.map((message) => {
                                const imagePayload = parseConversationImageMessage(message.content);
                                return {
                                    role: message.role,
                                    content: imagePayload?.content || buildHistoryPromptText(message),
                                    imageUrls: imagePayload?.imageUrls,
                                };
                            }),
                        });
                        const referenceImage = imageReference
                            ? await loadImageReference(req, imageReference.url)
                            : null;
                        const imageResponse = await generateImageViaBackend(req.headers, {
                            prompt: imagePrompt,
                            aspectRatio: aspectRatio || '1:1',
                            count: 1,
                            referenceImage: referenceImage?.base64,
                            referenceImageMime: referenceImage?.mimeType,
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

                    const textModelMessages: OpenAIChatMessage[] = [
                        ...historyMessages,
                        { role: 'user', content: currentPromptText },
                    ];
                    const enriched = await enrichSystemPromptWithWebSearch({
                        systemPrompt,
                        messages: textModelMessages,
                        webSearchMode,
                    });
                    const systemPromptWithWebSearch = enriched.systemPrompt;

                    if (shouldStreamOpenAI) {
                        startHeartbeat();
                        if (shouldStreamVideoBreakdownGpt) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                                type: 'status',
                                content: VIDEO_BREAKDOWN_STREAM_STATUS,
                            })}\n\n`));
                        }

                        await streamYunwuOpenAIChat({
                            systemPrompt: systemPromptWithWebSearch,
                            messages: textModelMessages,
                            temperature: 0.8,
                            maxTokens: 8192,
                            onText: (textChunk) => {
                                if (!textChunk) {
                                    return;
                                }

                                fullResponse += textChunk;
                                flushVisibleText();
                            },
                        });
                    } else if (shouldStreamClaude) {
                        await streamYunwuClaudeChat({
                            systemPrompt: systemPromptWithWebSearch,
                            messages: textModelMessages,
                            webSearchMode: 'off',
                            temperature: 0.8,
                            maxTokens: 8192,
                            onText: (textChunk) => {
                                if (!textChunk) {
                                    return;
                                }

                                fullResponse += textChunk;
                                flushVisibleText();
                            },
                        });
                    } else if (responseModel === 'gemini-deep-thinking') {
                        const deepThinkingMessages: GeminiChatMessage[] = historyMessages.map((message) => ({
                            role: message.role,
                            content: typeof message.content === 'string' ? message.content : '',
                        }));
                        deepThinkingMessages.push({
                            role: 'user',
                            content: currentPromptText,
                        });

                        await streamGeminiDeepThinkingChat({
                            systemPrompt: systemPromptWithWebSearch,
                            messages: deepThinkingMessages,
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
                    } else {
                        const geminiMessages: GeminiChatMessage[] = historyMessages.map((message) => ({
                            role: message.role,
                            content: typeof message.content === 'string' ? message.content : '',
                        }));
                        geminiMessages.push(await buildGeminiCurrentTurnMessage(content, attachments));

                        await streamYunwuGeminiChat({
                            systemPrompt: systemPromptWithWebSearch,
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
                                    ? buildConversationTitle(bot.name, [{ role: 'user', content: userDisplayContent }])
                                    : conversation.title,
                                updatedAt: new Date(),
                            },
                        });
                    });

                    await rememberConversationTurn({
                        userId,
                        botRouteId: bot.routeId,
                        conversationId,
                        userMessage: currentPromptText,
                        assistantMessage: cleanResponse,
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
                    stopHeartbeat();
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
                'Content-Encoding': 'none',
                'X-Accel-Buffering': 'no',
            },
        });
    } catch (error) {
        await Promise.all(tempVideoTokensToCleanup.map((token) => deleteTempVideo(token)));
        return errorResponse(error);
    }
}
