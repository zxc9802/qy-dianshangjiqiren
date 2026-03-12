'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useConversationsStore, type Conversation } from '../../stores/conversations';
import { startPcm16kMonoRecorder, type Pcm16Recorder } from '../../lib/pcmRecorder';
import { api, type AttachmentInfo, type ChatAttachmentPayload } from '../../lib/api';
import { BUILTIN_BOT_MAP, BUILTIN_BOT_NAME_MAP, GENERIC_CHAT_BOT_ID } from '../../lib/builtin-bots';
import {
    buildMessageDisplayContent,
    ChatAttachmentFrame,
    ChatAttachmentKind,
    formatDuration,
    stripAttachmentDisplayLabels,
} from '../../lib/chat-attachments';
import {
    DEFAULT_RESPONSE_MODEL,
    RESPONSE_MODEL_OPTIONS,
    RESPONSE_MODEL_STORAGE_PREFIX,
    type ResponseModel,
} from '../../lib/chat-models';
import styles from './chat.module.css';
import {
    MessageSquare, BarChart3, Trash2, Sparkles, FileText,
    ClipboardList, Paperclip, Mic, Loader2, Send, ArrowLeft,
    Plus, ChevronDown, Star, Pin, CheckSquare, Square, ArrowRight, Undo2, ImageIcon, Video,
} from 'lucide-react';

interface MessageAttachment extends Omit<AttachmentInfo, 'id' | 'fileType' | 'fileUrl' | 'kind'> {
    id?: string;
    fileType?: string;
    fileUrl?: string;
    kind: ChatAttachmentKind;
}

interface MessageItem {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    kind?: 'text' | 'image';
    imageUrls?: string[];
    imagePrompt?: string;
    aspectRatio?: string;
    attachments?: MessageAttachment[];
}

interface AttachedFile {
    file: File;
    name: string;
    extractedText?: string;
    previewUrl: string | null;
    isImage: boolean;
    isVideo: boolean;
    kind: ChatAttachmentKind;
    mimeType?: string;
    durationMs?: number;
    transcript?: string;
    frames?: ChatAttachmentFrame[];
    tempVideoToken?: string;
}

const MAX_ATTACHMENTS = 10;
const IMAGE_MODE_ASPECT_RATIO = '1:1';

interface WfState {
    workflowId: string;
    workflowName: string;
    steps: Array<{ botId: string; botName: string }>;
    currentStep: number;
    stepOutputs: string[];
    selectedMessages: Record<number, string[]>;
}

const BOT_NAMES = BUILTIN_BOT_NAME_MAP;

function normalizeMessageAttachments(attachments?: AttachmentInfo[]): MessageAttachment[] | undefined {
    if (!attachments?.length) {
        return undefined;
    }

    return attachments.map((attachment) => ({
        ...attachment,
        kind: attachment.kind || (attachment.fileType?.startsWith('video/') ? 'video' : attachment.fileType?.startsWith('image/') ? 'image' : 'document'),
    }));
}

function buildRoute(botId: string, params: { cid?: string | null; wf?: string | null; name?: string | null }) {
    const query = new URLSearchParams();
    if (params.cid) query.set('cid', params.cid);
    if (params.wf) query.set('wf', params.wf);
    if (params.name) query.set('name', params.name);
    const search = query.toString();
    return `/chat/${botId}${search ? `?${search}` : ''}`;
}

function toMessages(conversation: Conversation, fallback: string): MessageItem[] {
    const history = conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        kind: message.kind,
        imageUrls: message.imageUrls,
        imagePrompt: message.imagePrompt,
        aspectRatio: message.aspectRatio,
        attachments: normalizeMessageAttachments(message.attachments),
    }));

    if (history.some((message) => message.id === 'welcome')) {
        return history;
    }

    return [{ id: 'welcome', role: 'assistant', content: fallback }, ...history];
}

function stripSuggestionBlock(text: string): string {
    return text
        .replace(/```json[\s\S]*?\{"suggestions":\s*\[[\s\S]*?\}[\s\S]*?```/g, '')
        .replace(/\n?```json[\s\S]*$/g, '')
        .replace(/\n?\{\s*"suggestions"\s*:\s*\[[\s\S]*$/g, '')
        .trimEnd();
}

export default function ChatPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const botId = params.id as string;
    const conversationId = searchParams.get('cid');
    const workflowFlag = searchParams.get('wf');
    const urlName = searchParams.get('name');
    const launcherDraft = searchParams.get('draft')?.trim() || '';
    const requestedResponseModel = searchParams.get('rm') === 'gpt-5.4'
        ? 'gpt-5.4'
        : searchParams.get('rm') === 'gemini'
            ? 'gemini'
            : null;
    const builtinBot = BUILTIN_BOT_MAP[botId];
    const fallbackBotName = BOT_NAMES[botId] || urlName || 'AI助手';
    const fallbackWelcome = builtinBot?.welcome
        || (botId === GENERIC_CHAT_BOT_ID
            ? '先告诉我你想解决什么。我会先把关键要求问清，再给你方案。'
            : `你好，我是${fallbackBotName}，说说你的需求。`);

    const {
        conversations,
        favorites,
        createConversation,
        fetchConversation,
        getConversation,
        loadConversations,
        deleteConversation,
        toggleFavorite,
        removeFavorite,
    } = useConversationsStore();

    const currentConversation = conversationId ? getConversation(conversationId) : undefined;
    const botName = currentConversation?.botName || fallbackBotName;

    const [messages, setMessages] = useState<MessageItem[]>([{ id: 'welcome', role: 'assistant', content: fallbackWelcome }]);
    const [inputText, setInputText] = useState('');
    const [imageModeEnabled, setImageModeEnabled] = useState(false);
    const [responseModel, setResponseModel] = useState<ResponseModel>(DEFAULT_RESPONSE_MODEL);
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [imageStatusText, setImageStatusText] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [isLoadingConversation, setIsLoadingConversation] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const skipHydrationConversationIdRef = useRef<string | null>(null);
    const launcherDraftKeyRef = useRef<string | null>(null);
    const streamingFrameRef = useRef<number | null>(null);
    const pendingStreamingTextRef = useRef('');

    const [wfState, setWfState] = useState<WfState | null>(null);
    const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [botSwitcherOpen, setBotSwitcherOpen] = useState(false);
    const [sidebarTab, setSidebarTab] = useState<'history' | 'favorites'>('history');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const recorderRef = useRef<Pcm16Recorder | null>(null);
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, streamingText, scrollToBottom]);

    useEffect(() => {
        void loadConversations().catch((error) => console.error('[Chat] load conversations failed', error));
    }, [loadConversations]);

    useEffect(() => {
        if (!workflowFlag || typeof window === 'undefined') return;
        const raw = sessionStorage.getItem('wf_state');
        if (!raw) return;
        try {
            setWfState(JSON.parse(raw) as WfState);
        } catch {
            setWfState(null);
        }
    }, [workflowFlag]);

    useEffect(() => {
        setSelectedMsgIds(new Set());
    }, [botId, conversationId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (requestedResponseModel) {
            setResponseModel(requestedResponseModel);
            return;
        }
        const saved = window.localStorage.getItem(`${RESPONSE_MODEL_STORAGE_PREFIX}${botId}`);
        if (saved === 'gpt-5.4' || saved === 'gemini') {
            setResponseModel(saved);
            return;
        }
        setResponseModel(DEFAULT_RESPONSE_MODEL);
    }, [botId, requestedResponseModel]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(`${RESPONSE_MODEL_STORAGE_PREFIX}${botId}`, responseModel);
    }, [botId, responseModel]);

    useEffect(() => {
        if (!conversationId) {
            skipHydrationConversationIdRef.current = null;
            setMessages([{ id: 'welcome', role: 'assistant', content: fallbackWelcome }]);
            setStreamingText('');
            setSuggestions([]);
            setIsStreaming(false);
            return;
        }

        if (skipHydrationConversationIdRef.current === conversationId) {
            skipHydrationConversationIdRef.current = null;
            setIsLoadingConversation(false);
            return;
        }

        let cancelled = false;
        setIsLoadingConversation(true);
        fetchConversation(conversationId)
            .then((conversation) => {
                if (cancelled) return;
                setMessages(toMessages(conversation, fallbackWelcome));
            })
            .catch((error) => {
                if (cancelled) return;
                console.error('[Chat] fetch conversation failed', error);
                setMessages([{ id: 'welcome', role: 'assistant', content: fallbackWelcome }]);
            })
            .finally(() => {
                if (!cancelled) setIsLoadingConversation(false);
            });

        return () => {
            cancelled = true;
        };
    }, [conversationId, fallbackWelcome, fetchConversation]);

    const refreshConversation = useCallback(async (id: string, options?: { syncMessages?: boolean }) => {
        const conversation = await fetchConversation(id);
        if (options?.syncMessages !== false) {
            setMessages(toMessages(conversation, fallbackWelcome));
        }
        return conversation;
    }, [fallbackWelcome, fetchConversation]);

    const botConversations = useMemo(
        () => conversations.filter((conversation) => conversation.botId === botId).sort((a, b) => b.updatedAt - a.updatedAt),
        [botId, conversations],
    );
    const botFavorites = useMemo(
        () => favorites.filter((conversation) => conversation.botId === botId).sort((a, b) => b.updatedAt - a.updatedAt),
        [botId, favorites],
    );
    const allBots = useMemo(() => {
        const base = Object.entries(BOT_NAMES).map(([id, name]) => ({ id, name }));
        if (botId.startsWith('custom-') && !base.some((bot) => bot.id === botId)) {
            return [{ id: botId, name: botName }, ...base];
        }
        return base;
    }, [botId, botName]);
    const renderedMessages = useMemo(
        () => messages.map((message) => {
            const textContent = message.attachments?.length
                ? stripAttachmentDisplayLabels(message.content, message.attachments)
                : message.content;

            return {
                ...message,
                textContent,
                html: formatMessage(stripSuggestionBlock(textContent)),
            };
        }),
        [messages],
    );
    const renderedStreamingText = useMemo(
        () => (streamingText ? formatMessage(streamingText) : ''),
        [streamingText],
    );

    const flushStreamingText = useCallback(() => {
        streamingFrameRef.current = null;
        setStreamingText(stripSuggestionBlock(pendingStreamingTextRef.current));
    }, []);

    const clearAttachments = useCallback(() => {
        attachedFiles.forEach((file) => {
            if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
        });
        setAttachedFiles([]);
    }, [attachedFiles]);

    const toggleImageMode = () => {
        if (!imageModeEnabled && attachedFiles.length > 0) {
            clearAttachments();
        }
        setImageModeEnabled((current) => !current);
    };

    const removeAttachment = (index: number) => {
        setAttachedFiles((current) => current.filter((file, itemIndex) => {
            if (itemIndex === index && file.previewUrl) {
                URL.revokeObjectURL(file.previewUrl);
            }
            return itemIndex !== index;
        }));
    };

    const parseAttachedFile = async (file: File) => {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        return {
            kind: (data.kind || 'document') as ChatAttachmentKind,
            fileName: data.fileName as string,
            fileSize: Number(data.fileSize || file.size),
            mimeType: typeof data.mimeType === 'string' ? data.mimeType : file.type || undefined,
            previewUrl: typeof data.previewUrl === 'string' ? data.previewUrl : undefined,
            extractedText: typeof data.content === 'string' ? data.content : '',
            durationMs: typeof data.durationMs === 'number' ? data.durationMs : undefined,
            transcript: typeof data.transcript === 'string' ? data.transcript : undefined,
            tempVideoToken: typeof data.tempVideoToken === 'string' ? data.tempVideoToken : undefined,
            frames: Array.isArray(data.frames)
                ? data.frames
                    .filter((frame: unknown): frame is { url: string; timestampMs: number } => (
                        typeof frame === 'object'
                        && frame !== null
                        && typeof (frame as { url?: unknown }).url === 'string'
                        && typeof (frame as { timestampMs?: unknown }).timestampMs === 'number'
                    ))
                    .map((frame: { url: string; timestampMs: number }) => ({ url: frame.url, timestampMs: frame.timestampMs }))
                : [],
        } satisfies ChatAttachmentPayload;
    };

    const sendMessage = useCallback(async (rawText: string) => {
        const isImageRequest = imageModeEnabled;
        const hasFiles = !isImageRequest && attachedFiles.length > 0;
        if ((!rawText.trim() && !hasFiles) || isStreaming || isUploading) return;

        let parsedAttachments = attachedFiles;
        if (!isImageRequest && attachedFiles.length > 0) {
            setIsUploading(true);
            try {
                parsedAttachments = [];
                for (const attachment of attachedFiles) {
                    const parsed = await parseAttachedFile(attachment.file);
                    parsedAttachments.push({
                        ...attachment,
                        name: parsed.fileName,
                        kind: parsed.kind,
                        mimeType: parsed.mimeType,
                        extractedText: parsed.extractedText,
                        durationMs: parsed.durationMs,
                        transcript: parsed.transcript,
                        tempVideoToken: parsed.tempVideoToken,
                        frames: parsed.frames,
                        previewUrl: attachment.isImage ? attachment.previewUrl : (parsed.previewUrl || attachment.previewUrl),
                    });
                }
            } catch (error) {
                alert(error instanceof Error ? error.message : '文件上传失败');
                return;
            } finally {
                setIsUploading(false);
            }
        }

        const messageText = rawText.trim();
        const requestAttachments: ChatAttachmentPayload[] = parsedAttachments.map((attachment) => ({
            kind: attachment.kind,
            fileName: attachment.name,
            fileSize: attachment.file.size,
            mimeType: attachment.mimeType || attachment.file.type || undefined,
            previewUrl: attachment.kind === 'video' ? attachment.previewUrl || undefined : undefined,
            extractedText: attachment.extractedText || '',
            durationMs: attachment.durationMs,
            transcript: attachment.transcript,
            tempVideoToken: attachment.tempVideoToken,
            frames: attachment.frames,
        }));
        const optimisticAttachments: MessageAttachment[] = parsedAttachments.map((attachment) => ({
            kind: attachment.kind,
            fileName: attachment.name,
            fileSize: attachment.file.size,
            mimeType: attachment.mimeType || attachment.file.type || undefined,
            previewUrl: attachment.previewUrl || undefined,
            extractedText: attachment.extractedText || '',
            durationMs: attachment.durationMs,
            transcript: attachment.transcript,
            frames: attachment.frames,
        }));

        const displayText = requestAttachments.length > 0
            ? buildMessageDisplayContent(messageText, requestAttachments)
            : messageText;

        let content = messageText;
        if (wfState && wfState.currentStep > 0 && wfState.stepOutputs[wfState.currentStep - 1]) {
            content = `上一步输出：\n${wfState.stepOutputs[wfState.currentStep - 1]}\n\n当前用户消息：\n${content}`;
        }

        if (parsedAttachments.length > 0) {
            clearAttachments();
        }

        const createConversationPromise = !conversationId ? createConversation(botId) : null;

        setMessages((current) => [
            ...current,
            {
                id: `user-${Date.now()}`,
                role: 'user',
                content: displayText,
                kind: isImageRequest ? 'image' : 'text',
                imagePrompt: isImageRequest ? displayText : undefined,
                aspectRatio: isImageRequest ? IMAGE_MODE_ASPECT_RATIO : undefined,
                attachments: optimisticAttachments,
            },
        ]);
        setInputText('');
        setSuggestions([]);
        setIsStreaming(true);
        setStreamingText('');
        setImageStatusText(isImageRequest ? '正在提交绘图请求...' : '');

        await new Promise<void>((resolve) => {
            if (typeof window === 'undefined') {
                resolve();
                return;
            }
            window.requestAnimationFrame(() => resolve());
        });

        let activeConversationId = conversationId;
        let shouldRefreshConversation = false;

        try {
            if (!activeConversationId) {
                const created = createConversationPromise ? await createConversationPromise : await createConversation(botId);
                activeConversationId = created.id;
                skipHydrationConversationIdRef.current = created.id;
                router.replace(buildRoute(created.botId, { cid: created.id, wf: workflowFlag, name: created.botName }));
            }

            if (!activeConversationId) {
                throw new Error('创建会话失败');
            }

            const response = await api.sendConversationMessage(activeConversationId, {
                content,
                displayContent: displayText,
                inputType: isImageRequest ? 'image' : requestAttachments.some((attachment) => attachment.kind === 'video') ? 'video' : hasFiles ? 'file' : 'text',
                aspectRatio: isImageRequest ? IMAGE_MODE_ASPECT_RATIO : undefined,
                responseModel,
                attachments: requestAttachments,
            });

            if (!response.ok) {
                const payload = response.headers.get('content-type')?.includes('application/json')
                    ? await response.json()
                    : await response.text();
                const message = typeof payload === 'string'
                    ? payload
                    : payload?.message || payload?.error || '发送失败';
                throw new Error(message);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('响应流不可用');

            const decoder = new TextDecoder();
            let fullText = '';
            pendingStreamingTextRef.current = '';
            let pending = '';

            while (true) {
                const { done, value } = await reader.read();
                pending += decoder.decode(value || new Uint8Array(), { stream: !done });

                const lines = pending.split('\n');
                pending = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;

                    try {
                        const event = JSON.parse(line.slice(6));
                        if (event.type === 'text' && event.content) {
                            fullText += event.content;
                            pendingStreamingTextRef.current = fullText;
                            if (typeof window === 'undefined') {
                                setStreamingText(stripSuggestionBlock(fullText));
                            } else if (streamingFrameRef.current === null) {
                                streamingFrameRef.current = window.requestAnimationFrame(flushStreamingText);
                            }
                        } else if (event.type === 'suggestions' && Array.isArray(event.content)) {
                            setSuggestions(event.content);
                        } else if (event.type === 'status' && typeof event.content === 'string') {
                            setImageStatusText(event.content);
                        } else if (event.type === 'image' && event.content) {
                            setMessages((current) => [
                                ...current,
                                {
                                    id: `assistant-image-${Date.now()}`,
                                    role: 'assistant',
                                    content: event.content.content || '已生成图片。',
                                    kind: 'image',
                                    imageUrls: Array.isArray(event.content.imageUrls) ? event.content.imageUrls : [],
                                    imagePrompt: event.content.imagePrompt,
                                    aspectRatio: event.content.aspectRatio,
                                },
                            ]);
                            setImageStatusText('');
                        } else if (event.type === 'error') {
                            throw new Error(event.content || 'AI 回复失败');
                        }
                    } catch (error) {
                        if (error instanceof SyntaxError) continue;
                        throw error;
                    }
                }

                if (done) break;
            }

            if (pending.trim().startsWith('data: ')) {
                try {
                    const event = JSON.parse(pending.trim().slice(6));
                    if (event.type === 'status' && typeof event.content === 'string') {
                        setImageStatusText(event.content);
                    } else if (event.type === 'image' && event.content) {
                        setMessages((current) => [
                            ...current,
                            {
                                id: `assistant-image-${Date.now()}`,
                                role: 'assistant',
                                content: event.content.content || '已生成图片。',
                                kind: 'image',
                                imageUrls: Array.isArray(event.content.imageUrls) ? event.content.imageUrls : [],
                                imagePrompt: event.content.imagePrompt,
                                aspectRatio: event.content.aspectRatio,
                            },
                        ]);
                        setImageStatusText('');
                    } else if (event.type === 'error') {
                        throw new Error(event.content || 'AI 回复失败');
                    }
                } catch (error) {
                    if (!(error instanceof SyntaxError)) {
                        throw error;
                    }
                }
            }

            const finalText = stripSuggestionBlock(fullText).trim();
            if (finalText) {
                if (typeof window !== 'undefined' && streamingFrameRef.current !== null) {
                    window.cancelAnimationFrame(streamingFrameRef.current);
                }
                streamingFrameRef.current = null;
                pendingStreamingTextRef.current = finalText;
                setMessages((current) => [
                    ...current,
                    { id: `assistant-${Date.now()}`, role: 'assistant', content: finalText },
                ]);
            }

            shouldRefreshConversation = true;
        } catch (error) {
            const message = error instanceof Error ? error.message : '发送失败';
            setMessages((current) => [
                ...current,
                { id: `err-${Date.now()}`, role: 'assistant', content: `出错了：${message}` },
            ]);
        } finally {
            if (typeof window !== 'undefined' && streamingFrameRef.current !== null) {
                window.cancelAnimationFrame(streamingFrameRef.current);
            }
            streamingFrameRef.current = null;
            pendingStreamingTextRef.current = '';
            setIsStreaming(false);
            setStreamingText('');
            setImageStatusText('');

            if (shouldRefreshConversation && activeConversationId) {
                void refreshConversation(activeConversationId, { syncMessages: false }).catch((error) => {
                    console.error('[Chat] refresh conversation failed', error);
                });
            }
        }
    }, [
        attachedFiles,
        botId,
        clearAttachments,
        conversationId,
        createConversation,
        flushStreamingText,
        imageModeEnabled,
        isStreaming,
        isUploading,
        refreshConversation,
        responseModel,
        router,
        wfState,
        workflowFlag,
    ]);

    useEffect(() => {
        if (!launcherDraft) {
            launcherDraftKeyRef.current = null;
            return;
        }
        if (conversationId || isLoadingConversation || isStreaming) return;
        if (requestedResponseModel && responseModel !== requestedResponseModel) return;

        const draftKey = `${botId}:${responseModel}:${launcherDraft}`;
        if (launcherDraftKeyRef.current === draftKey) return;

        launcherDraftKeyRef.current = draftKey;
        void sendMessage(launcherDraft);
    }, [
        botId,
        conversationId,
        isLoadingConversation,
        isStreaming,
        launcherDraft,
        requestedResponseModel,
        responseModel,
        sendMessage,
    ]);

    const startNewConversation = () => {
        launcherDraftKeyRef.current = null;
        clearAttachments();
        setMessages([{ id: 'welcome', role: 'assistant', content: fallbackWelcome }]);
        setInputText('');
        setSuggestions([]);
        setStreamingText('');
        setIsStreaming(false);
        setSidebarOpen(false);
        router.push(buildRoute(botId, { wf: workflowFlag, name: urlName }));
    };

    const formatHistoryTime = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        return `${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;
        event.target.value = '';

        try {
            if (attachedFiles.length >= MAX_ATTACHMENTS) {
                throw new Error(`一次最多上传 ${MAX_ATTACHMENTS} 个文件`);
            }

            const availableSlots = MAX_ATTACHMENTS - attachedFiles.length;
            const nextFiles: AttachedFile[] = files.slice(0, availableSlots).map((file) => {
                const ext = file.name.split('.').pop()?.toLowerCase() || '';
                const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
                const isVideo = ['mp4', 'mov', 'webm', 'm4v'].includes(ext);
                return {
                    file,
                    name: file.name,
                    previewUrl: isImage ? URL.createObjectURL(file) : null,
                    isImage,
                    isVideo,
                    kind: isVideo ? 'video' : isImage ? 'image' : 'document',
                };
            });

            const existingVideoCount = attachedFiles.filter((file) => file.isVideo).length;
            const newVideoCount = nextFiles.filter((file) => file.isVideo).length;
            if (existingVideoCount + newVideoCount > 1) {
                nextFiles.forEach((file) => {
                    if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
                });
                throw new Error('一次消息最多上传 1 个视频');
            }

            setAttachedFiles((current) => [...current, ...nextFiles]);

            if (files.length > availableSlots) {
                alert(`一次最多上传 ${MAX_ATTACHMENTS} 个文件，其余文件已忽略`);
            }
        } catch (error) {
            alert(error instanceof Error ? error.message : '文件上传失败');
        }
    };

    const toggleVoice = async () => {
        if (isRecording) {
            setIsRecording(false);
            const recorder = recorderRef.current;
            recorderRef.current = null;
            if (!recorder) return;
            try {
                const audioBlob = await recorder.stop();
                if (audioBlob.size < 1000) throw new Error('录音时间太短，请重试');
                setIsTranscribing(true);
                const formData = new FormData();
                formData.append('audio', audioBlob, 'recording.wav');
                const response = await fetch('/api/voice', { method: 'POST', body: formData });
                const data = await response.json();
                if (data.text) setInputText((current) => current + data.text);
                else throw new Error(data.error || '语音识别失败');
            } catch (error) {
                alert(error instanceof Error ? error.message : '语音识别失败');
            } finally {
                setIsTranscribing(false);
            }
            return;
        }

        try {
            recorderRef.current = await startPcm16kMonoRecorder();
            setIsRecording(true);
        } catch (error) {
            alert(error instanceof Error ? error.message : '无法访问麦克风');
        }
    };

    const generateReport = async () => {
        if (messages.length < 3) {
            alert('对话记录太少，至少需要一轮完整对话才能生成报告');
            return;
        }

        setIsGeneratingReport(true);
        try {
            const response = await fetch('/api/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ botId, botName, messages }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            const payload = { ...data, chatHistory: messages };
            localStorage.setItem('__report_data__', JSON.stringify(payload));
            if (conversationId) localStorage.setItem(`report-${conversationId}`, JSON.stringify(payload));
            window.open('/report', '_blank');
        } catch (error) {
            alert(error instanceof Error ? error.message : '报告生成失败');
        } finally {
            setIsGeneratingReport(false);
        }
    };

    const assistantMessages = messages.filter((message) => message.role === 'assistant' && message.id !== 'welcome' && message.kind !== 'image');
    const showLoadingBubble = isLoadingConversation && !isStreaming && messages.length <= 1;
    const showStreamingBubble = isStreaming;

    const togglePinMsg = (id: string) => setSelectedMsgIds((current) => {
        const next = new Set(current);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        return next;
    });

    const handleNextStep = () => {
        if (!wfState) return;
        const output = messages
            .filter((message) => selectedMsgIds.has(message.id))
            .map((message) => message.content)
            .join('\n\n---\n\n');
        const stepOutputs = [...wfState.stepOutputs];
        stepOutputs[wfState.currentStep] = output;
        const nextStep = wfState.currentStep + 1;
        sessionStorage.setItem('wf_state', JSON.stringify({ ...wfState, stepOutputs, currentStep: nextStep }));
        setSelectedMsgIds(new Set());
        if (nextStep >= wfState.steps.length) {
            alert('工作流已完成');
            router.push('/');
            return;
        }
        router.push(`/chat/${wfState.steps[nextStep].botId}?wf=1`);
    };

    const handleBackStep = () => {
        if (!wfState || wfState.currentStep <= 0) return;
        const prevStep = wfState.currentStep - 1;
        sessionStorage.setItem('wf_state', JSON.stringify({ ...wfState, currentStep: prevStep }));
        setSelectedMsgIds(new Set());
        router.push(`/chat/${wfState.steps[prevStep].botId}?wf=1`);
    };

    const openConversation = (conversation: Conversation) => {
        setSidebarOpen(false);
        router.push(buildRoute(conversation.botId, { cid: conversation.id, wf: workflowFlag, name: conversation.botName }));
    };
    return (
        <div className={styles.layout}>
            <aside className={`${styles.chatSidebar} ${sidebarOpen ? styles.chatSidebarOpen : ''}`}>
                <div className={styles.chatSidebarHeader}>
                    <div style={{ display: 'flex', width: '100%' }}>
                        <button
                            onClick={() => setSidebarTab('history')}
                            style={{
                                flex: 1,
                                padding: '8px 0',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: 13,
                                fontWeight: 600,
                                background: sidebarTab === 'history' ? 'var(--bg-surface, #fff)' : 'transparent',
                                color: sidebarTab === 'history' ? 'var(--text-primary, #0f172a)' : 'var(--text-tertiary, #94a3b8)',
                                borderBottom: sidebarTab === 'history' ? '2px solid #2563eb' : '2px solid transparent',
                            }}
                        >
                            <MessageSquare size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                            聊天记录
                        </button>
                        <button
                            onClick={() => setSidebarTab('favorites')}
                            style={{
                                flex: 1,
                                padding: '8px 0',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: 13,
                                fontWeight: 600,
                                background: sidebarTab === 'favorites' ? 'var(--bg-surface, #fff)' : 'transparent',
                                color: sidebarTab === 'favorites' ? '#eab308' : 'var(--text-tertiary, #94a3b8)',
                                borderBottom: sidebarTab === 'favorites' ? '2px solid #eab308' : '2px solid transparent',
                            }}
                        >
                            <Star size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                            收藏
                        </button>
                    </div>
                </div>
                <div className={styles.chatSidebarList}>
                    {(sidebarTab === 'history' ? botConversations : botFavorites).length === 0 ? (
                        <div className={styles.chatSidebarEmpty}>
                            {sidebarTab === 'history' ? '暂无对话记录' : '暂无收藏'}
                        </div>
                    ) : (
                        (sidebarTab === 'history' ? botConversations : botFavorites).map((conversation) => (
                            <div
                                key={conversation.id}
                                className={`${styles.chatSidebarItem} ${conversation.id === conversationId ? styles.chatSidebarItemActive : ''}`}
                                onClick={() => openConversation(conversation)}
                            >
                                <p className={styles.chatSidebarPreview}>
                                    {conversation.messages[conversation.messages.length - 1]?.content.slice(0, 30) || conversation.title || '新对话'}
                                </p>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                                    <span className={styles.chatSidebarTime}>{formatHistoryTime(conversation.updatedAt)}</span>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        {sidebarTab === 'history' && (
                                            <button
                                                className={styles.chatSidebarAction}
                                                style={{ color: conversation.isFavorite ? '#eab308' : undefined }}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void toggleFavorite(conversation.id);
                                                }}
                                            >
                                                <Star size={14} fill={conversation.isFavorite ? '#eab308' : 'none'} />
                                            </button>
                                        )}
                                        {sidebarTab === 'history' && typeof window !== 'undefined' && localStorage.getItem(`report-${conversation.id}`) && (
                                            <button
                                                className={styles.chatSidebarAction}
                                                style={{ color: '#3b82f6' }}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    const saved = localStorage.getItem(`report-${conversation.id}`);
                                                    if (saved) {
                                                        localStorage.setItem('__report_data__', saved);
                                                        window.open('/report', '_blank');
                                                    }
                                                }}
                                            >
                                                <BarChart3 size={14} />
                                            </button>
                                        )}
                                        <button
                                            className={styles.chatSidebarAction}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                if (sidebarTab === 'favorites') {
                                                    void removeFavorite(conversation.id);
                                                    return;
                                                }

                                                void deleteConversation(conversation.id);
                                                if (conversation.id === conversationId) {
                                                    startNewConversation();
                                                }
                                            }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </aside>

            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <button onClick={() => router.push('/')} className={styles.backBtn}>
                        <ArrowLeft size={16} />
                        返回
                    </button>
                    <button onClick={startNewConversation} className={styles.newChatBtn}>
                        <Plus size={16} />
                        新对话
                    </button>
                </div>
                <div className={styles.headerRight}>
                    <button onClick={generateReport} className={styles.historyBtn} disabled={isGeneratingReport || isStreaming}>
                        {isGeneratingReport ? (
                            <>
                                <Sparkles size={14} />
                                生成中...
                            </>
                        ) : (
                            <>
                                <FileText size={14} />
                                生成报告
                            </>
                        )}
                    </button>
                    <button onClick={() => setSidebarOpen(!sidebarOpen)} className={styles.historyBtn}>
                        <ClipboardList size={14} />
                        历史记录
                    </button>
                    <div className={styles.botSwitcher}>
                        <h2 className={styles.botName} onClick={() => setBotSwitcherOpen(!botSwitcherOpen)}>
                            {botName} <span className={styles.switchArrow}><ChevronDown size={14} /></span>
                        </h2>
                        {botSwitcherOpen && (
                            <div className={styles.switcherDropdown}>
                                <div className={styles.switcherList}>
                                    {allBots.map((bot) => (
                                        <button
                                            key={bot.id}
                                            className={`${styles.switcherItem} ${bot.id === botId ? styles.switcherItemActive : ''}`}
                                            onClick={() => {
                                                setBotSwitcherOpen(false);
                                                router.push(buildRoute(bot.id, { name: bot.name }));
                                            }}
                                        >
                                            {bot.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {wfState && (
                <div className={styles.wfProgressBar}>
                    <span className={styles.wfProgressTitle}>工作流：{wfState.workflowName}</span>
                    <div className={styles.wfSteps}>
                        {wfState.steps.map((step, index) => (
                            <span
                                key={`${step.botId}-${index}`}
                                className={`${styles.wfStepDot} ${index === wfState.currentStep ? styles.wfStepCurrent : index < wfState.currentStep ? styles.wfStepDone : ''}`}
                            >
                                <span className={styles.wfStepNum}>{index + 1}</span>
                                <span className={styles.wfStepName}>{step.botName}</span>
                                {index < wfState.steps.length - 1 && <span className={styles.wfStepLine}>→</span>}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div className={styles.messagesContainer}>
                <div className={styles.messages}>
                    {wfState && wfState.currentStep > 0 && wfState.stepOutputs[wfState.currentStep - 1] && (
                        <div className={styles.wfContextCard}>
                            <div className={styles.wfContextLabel}>
                                上一步（{wfState.steps[wfState.currentStep - 1]?.botName}）的成果：
                            </div>
                            <div className={styles.wfContextContent}>
                                {wfState.stepOutputs[wfState.currentStep - 1].slice(0, 300)}
                                {wfState.stepOutputs[wfState.currentStep - 1].length > 300 ? '...' : ''}
                            </div>
                        </div>
                    )}
                    {renderedMessages.map((message) => (
                        <div
                            key={message.id}
                            className={`${styles.message} ${message.role === 'user' ? styles.userMsg : styles.assistantMsg} ${wfState && selectedMsgIds.has(message.id) ? styles.msgPinned : ''}`}
                        >
                            <div className={styles.msgBubble}>
                                {message.kind === 'image' && message.imageUrls?.length ? (
                                    <div className={styles.imageMessage}>
                                        {message.content ? (
                                            <div className={styles.msgContent} dangerouslySetInnerHTML={{ __html: message.html }} />
                                        ) : null}
                                        {message.imagePrompt ? (
                                            <div className={styles.imagePrompt}>
                                                <span>绘图提示词</span>
                                                <p>{message.imagePrompt}</p>
                                            </div>
                                        ) : null}
                                        <div className={styles.imageGrid}>
                                            {message.imageUrls.map((imageUrl, imageIndex) => (
                                                <a
                                                    key={`${imageUrl}-${imageIndex}`}
                                                    href={imageUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className={styles.imageLink}
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element -- generated chat images are data URIs or remote assets returned at runtime */}
                                                    <img
                                                        src={imageUrl}
                                                        alt={`generated-${imageIndex + 1}`}
                                                        className={styles.imageThumb}
                                                        loading="lazy"
                                                    />
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className={styles.attachmentMessage}>
                                        {message.attachments?.length ? (
                                            <div className={styles.messageAttachmentGroup}>
                                                {message.attachments.map((attachment, attachmentIndex) => (
                                                    <div
                                                        key={`${attachment.fileName}-${attachmentIndex}`}
                                                        className={`${styles.messageAttachmentCard} ${attachment.kind === 'video' ? styles.messageAttachmentVideo : ''}`}
                                                    >
                                                        <div className={styles.messageAttachmentHead}>
                                                            <span className={styles.messageAttachmentBadge}>
                                                                {attachment.kind === 'video' ? (
                                                                    <><Video size={14} /> 视频</>
                                                                ) : attachment.kind === 'image' ? (
                                                                    <><ImageIcon size={14} /> 图片</>
                                                                ) : (
                                                                    <><FileText size={14} /> 文件</>
                                                                )}
                                                            </span>
                                                            {attachment.kind === 'video' && attachment.durationMs ? (
                                                                <span className={styles.messageAttachmentMeta}>
                                                                    时长 {formatDuration(attachment.durationMs)}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <div className={styles.messageAttachmentName}>{attachment.fileName}</div>
                                                        {attachment.kind === 'video' && attachment.frames?.length ? (
                                                            <div className={styles.videoFrameGrid}>
                                                                {attachment.frames.map((frame, frameIndex) => (
                                                                    <div key={`${frame.url}-${frameIndex}`} className={styles.videoFrameItem}>
                                                                        {/* eslint-disable-next-line @next/next/no-img-element -- persisted video keyframes are served from local static files */}
                                                                        <img
                                                                            src={frame.url}
                                                                            alt={`${attachment.fileName}-frame-${frameIndex + 1}`}
                                                                            className={styles.videoFrameThumb}
                                                                            loading="lazy"
                                                                        />
                                                                        <span className={styles.videoFrameTime}>{formatDuration(frame.timestampMs)}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : attachment.kind === 'image' && attachment.previewUrl ? (
                                                            /* eslint-disable-next-line @next/next/no-img-element -- image attachment previews may come from object URLs or persisted paths */
                                                            <img
                                                                src={attachment.previewUrl}
                                                                alt={attachment.fileName}
                                                                className={styles.messageAttachmentPreview}
                                                                loading="lazy"
                                                            />
                                                        ) : null}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                        {message.textContent ? (
                                            <div className={styles.msgContent} dangerouslySetInnerHTML={{ __html: message.html }} />
                                        ) : null}
                                    </div>
                                )}
                                {wfState && message.role === 'assistant' && message.id !== 'welcome' && message.kind !== 'image' && (
                                    <button
                                        className={`${styles.pinBtn} ${selectedMsgIds.has(message.id) ? styles.pinBtnActive : ''}`}
                                        onClick={() => togglePinMsg(message.id)}
                                    >
                                        <Pin size={14} />
                                        {selectedMsgIds.has(message.id) ? '已选' : '选择'}
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    {showLoadingBubble && (
                        <div className={`${styles.message} ${styles.assistantMsg}`}>
                            <div className={styles.msgBubble}>
                                <div className={styles.thinking}>
                                    <span />
                                    <span />
                                    <span />
                                </div>
                            </div>
                        </div>
                    )}
                    {showStreamingBubble && (
                        <div className={`${styles.message} ${styles.assistantMsg}`}>
                            <div className={styles.msgBubble}>
                                {streamingText ? (
                                    <div className={styles.msgContent} dangerouslySetInnerHTML={{ __html: renderedStreamingText }} />
                                ) : imageModeEnabled ? (
                                    <div className={styles.imagePending}>
                                        <div className={styles.thinking}>
                                            <span />
                                            <span />
                                            <span />
                                        </div>
                                        <div className={styles.imagePendingText}>
                                            {imageStatusText || '正在生成图片，通常需要 10 到 40 秒。'}
                                        </div>
                                    </div>
                                ) : (
                                    <div className={styles.thinking}>
                                        <span />
                                        <span />
                                        <span />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {suggestions.length > 0 && !isStreaming && !imageModeEnabled && (
                <div className={styles.suggestions}>
                    {suggestions.map((suggestion, index) => (
                        <button
                            key={`${suggestion}-${index}`}
                            className={styles.suggestionBtn}
                            onClick={() => void sendMessage(suggestion)}
                        >
                            {suggestion}
                        </button>
                    ))}
                </div>
            )}

            {wfState && (
                <div className={styles.wfActionBar}>
                    <div className={styles.wfActionLeft}>
                        <button
                            onClick={() => setSelectedMsgIds(
                                selectedMsgIds.size === assistantMessages.length
                                    ? new Set()
                                    : new Set(assistantMessages.map((message) => message.id)),
                            )}
                            className={styles.wfSelectBtn}
                        >
                            {selectedMsgIds.size === assistantMessages.length && assistantMessages.length > 0 ? (
                                <>
                                    <CheckSquare size={14} />
                                    取消全选
                                </>
                            ) : (
                                <>
                                    <Square size={14} />
                                    全选
                                </>
                            )}
                        </button>
                        <span className={styles.wfSelectedCount}>已选 {selectedMsgIds.size} 条</span>
                    </div>
                    <div className={styles.wfActionRight}>
                        {wfState.currentStep > 0 && (
                            <button onClick={handleBackStep} className={styles.wfBackBtn}>
                                <Undo2 size={14} />
                                回退上一步
                            </button>
                        )}
                        <button onClick={handleNextStep} disabled={isStreaming || selectedMsgIds.size === 0} className={styles.wfForwardBtn}>
                            {wfState.currentStep + 1 >= wfState.steps.length ? (
                                <>完成工作流</>
                            ) : (
                                <>
                                    传递到下一步
                                    <ArrowRight size={14} />
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            <div className={styles.inputBar}>
                {attachedFiles.length > 0 && (
                    <div className={styles.attachmentList}>
                        {attachedFiles.map((file, index) => (
                            <div key={`${file.name}-${index}`} className={styles.attachmentBar}>
                                {file.isImage && file.previewUrl ? (
                                    /* eslint-disable-next-line @next/next/no-img-element -- local attachment previews rely on temporary object URLs */
                                    <img src={file.previewUrl} alt={file.name} className={styles.attachThumb} />
                                ) : (
                                    <span className={styles.attachIcon}>
                                        {file.isVideo ? <Video size={18} /> : <FileText size={18} />}
                                    </span>
                                )}
                                <span className={styles.attachName}>{file.name}</span>
                                <button className={styles.attachRemove} onClick={() => removeAttachment(index)}>✕</button>
                            </div>
                        ))}
                    </div>
                )}
                <div className={styles.inputMeta}>
                    <div className={styles.metaControls}>
                        <button
                            type="button"
                            className={`${styles.modeToggle} ${imageModeEnabled ? styles.modeToggleActive : ''}`}
                            onClick={toggleImageMode}
                            disabled={isStreaming || isUploading || isTranscribing}
                        >
                            <ImageIcon size={16} />
                            {imageModeEnabled ? '绘图已开' : '绘图已关'}
                        </button>
                        <div className={styles.modelSwitcher}>
                            <select
                                aria-label="回答模型"
                                className={styles.modelSelect}
                                value={responseModel}
                                onChange={(event) => setResponseModel(event.target.value as ResponseModel)}
                                disabled={isStreaming || isUploading || isTranscribing}
                            >
                                {RESPONSE_MODEL_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown size={16} className={styles.modelSelectChevron} />
                        </div>
                    </div>
                    <span className={styles.inputHint}>
                        {isStreaming && imageModeEnabled
                            ? (imageStatusText || '正在生成图片，通常需要 10 到 40 秒。')
                            : imageModeEnabled
                            ? '当前输入会直接调用绘图能力，回答模型切换不会影响绘图结果。'
                            : `当前回答模型：${responseModel === 'gpt-5.4' ? 'GPT-5.4' : 'Gemini'}，可实时切换。`}
                    </span>
                </div>
                <div className={styles.inputWrapper}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.docx,.txt,.md,.csv,.pptx,.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.webm,.m4v"
                        onChange={handleFileUpload}
                        style={{ display: 'none' }}
                    />
                    <button
                        className={styles.toolBtn}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isStreaming || isUploading || imageModeEnabled}
                        title={imageModeEnabled ? '绘图模式下暂不支持上传文件' : '上传文件'}
                    >
                        {isUploading ? '...' : <Paperclip size={18} />}
                    </button>
                    <button
                        className={`${styles.toolBtn} ${isRecording ? styles.recording : ''} ${isTranscribing ? styles.recording : ''}`}
                        onClick={toggleVoice}
                        disabled={isStreaming || isTranscribing || isUploading}
                        title={isTranscribing ? '转录中...' : isRecording ? '停止录音' : '语音输入'}
                    >
                        {isTranscribing ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
                    </button>
                    <textarea
                        value={inputText}
                        onChange={(event) => setInputText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                void sendMessage(inputText);
                            }
                        }}
                        placeholder={isTranscribing
                            ? '语音转录中，请稍候...'
                            : imageModeEnabled
                                ? '输入想生成的图片描述...'
                                : '输入消息...'}
                        className={styles.textInput}
                        rows={1}
                        disabled={isStreaming || isUploading}
                    />
                    <button
                        onClick={() => void sendMessage(inputText)}
                        className={styles.sendBtn}
                        disabled={(!inputText.trim() && attachedFiles.length === 0) || isStreaming || isTranscribing || isUploading}
                    >
                        {imageModeEnabled ? <ImageIcon size={18} /> : <Send size={18} />}
                    </button>
                </div>
            </div>
        </div>
    );
}

function formatMessage(text: string): string {
    let formatted = text;

    formatted = formatted.replace(/```json[\s\S]*?\{"suggestions":\[\s\S]*?\}[\s\S]*?```/g, '');
    formatted = formatted.replace(/^#{1,6}\s*/gm, '');
    formatted = formatted.replace(/\n{3,}/g, '\n\n');
    formatted = formatted.replace(/\n\n+(\|)/g, '\n$1');
    formatted = formatted.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/^[\*\-\u2022]\s+/gm, '• ');
    formatted = formatted.replace(/^(\d+[\.\)\u3001])\s+/gm, '$1 ');
    formatted = formatted.replace(/^---+$/gm, '');

    const lines = formatted.split('\n');
    const parts: string[] = [];
    let inTable = false;
    let pendingBreaks = 0;

    const flushBreaks = (maxBreaks = 2) => {
        const count = Math.min(pendingBreaks, maxBreaks);
        for (let index = 0; index < count; index += 1) {
            parts.push('<br>');
        }
        pendingBreaks = 0;
    };

    for (const line of lines) {
        const trimmed = line.trim();
        const isTableLine = trimmed.startsWith('|') && trimmed.includes('|');

        if (isTableLine) {
            const cells = trimmed.split('|').filter((cell) => cell.trim()).map((cell) => cell.trim());
            if (cells.every((cell) => /^[-:]+$/.test(cell))) continue;

            if (!inTable) {
                pendingBreaks = Math.min(pendingBreaks, 1);
                flushBreaks(1);
                parts.push('<table>');
                inTable = true;
            }

            parts.push('<tr>' + cells.map((cell) => `<td>${cell}</td>`).join('') + '</tr>');
            continue;
        }

        if (inTable) {
            parts.push('</table>');
            inTable = false;
            pendingBreaks = Math.max(pendingBreaks, 1);
        }

        if (!trimmed) {
            pendingBreaks = Math.min(pendingBreaks + 1, 2);
            continue;
        }

        flushBreaks(2);
        parts.push(line);
        pendingBreaks = 1;
    }

    if (inTable) {
        parts.push('</table>');
    }

    return parts.join('')
        .replace(/^(<br>\s*)+/, '')
        .replace(/(<br>\s*)+$/, '');
}



