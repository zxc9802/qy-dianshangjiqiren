'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useConversationsStore, type Conversation } from '../../stores/conversations';
import { startPcm16kMonoRecorder, type Pcm16Recorder } from '../../lib/pcmRecorder';
import { api } from '../../lib/api';
import styles from './chat.module.css';
import {
    MessageSquare, BarChart3, Trash2, Sparkles, FileText,
    ClipboardList, Paperclip, Mic, Loader2, Send, ArrowLeft,
    Plus, ChevronDown, Star, Pin, CheckSquare, Square, ArrowRight, Undo2,
} from 'lucide-react';

interface MessageItem {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

interface AttachedFile {
    file: File;
    name: string;
    content?: string;
    previewUrl: string | null;
    isImage: boolean;
}

const MAX_ATTACHMENTS = 10;

interface WfState {
    workflowId: string;
    workflowName: string;
    steps: Array<{ botId: string; botName: string }>;
    currentStep: number;
    stepOutputs: string[];
    selectedMessages: Record<number, string[]>;
}

const BOT_NAMES: Record<string, string> = {
    '1': 'KPI教练',
    '2': 'SOP梳理AI教练',
    '3': 'OKR教练',
    '4': '电商商业顾问',
    '5': '招聘教练',
    '6': 'AI通用助手',
    '7': '一键出10图提示词',
    '8': '天猫爆款趋势拆解',
    '9': '卖点教练',
    '10': '天猫主图策划教练',
    '11': '爆款裂变分析AI教练',
    '12': '天猫评价教练',
    '13': '天猫竞争策略教练',
    '14': '天猫客单价提升教练',
    '15': '小红书爆文封面拆解',
    '16': '小红书私域搭建SOP',
    '17': '小红书爆文拆解复制',
    '18': '小红书爆款标题',
    '19': '小红书起号话题',
    '20': '小红书达人SOP流程',
    '21': '小红书正文拆解SOP',
    '22': '小红书笔记评论生成',
    '23': '毛泽东战略智能体',
    '24': '乔布斯产品教练',
    '25': '张一鸣商业教练',
    '26': '降税模型测算',
    '27': '股权架构设计',
    '28': '电商平台专项合规',
    '29': '薪酬与个税规划',
    '30': '预警诊断与稽查',
    '31': 'AI工作流开发需求细化',
    '32': '调研访谈-高价值场景',
    '33': '火火提示词调优',
    '34': 'AI工作流访谈教练',
};

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
    const fallbackBotName = BOT_NAMES[botId] || urlName || 'AI助手';
    const fallbackWelcome = '你好，我是' + fallbackBotName + '，说说你的需求。';

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
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [isLoadingConversation, setIsLoadingConversation] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const skipHydrationConversationIdRef = useRef<string | null>(null);
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
        () => messages.map((message) => ({ ...message, html: formatMessage(stripSuggestionBlock(message.content)) })),
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

    const clearAttachments = () => {
        attachedFiles.forEach((file) => {
            if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
        });
        setAttachedFiles([]);
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
            fileName: data.fileName as string,
            content: data.content as string,
        };
    };

    const sendMessage = async (rawText: string) => {
        const hasFiles = attachedFiles.length > 0;
        if ((!rawText.trim() && !hasFiles) || isStreaming || isUploading) return;

        let parsedAttachments = attachedFiles;
        if (attachedFiles.length > 0) {
            setIsUploading(true);
            try {
                parsedAttachments = [];
                for (const attachment of attachedFiles) {
                    const parsed = await parseAttachedFile(attachment.file);
                    parsedAttachments.push({
                        ...attachment,
                        name: parsed.fileName,
                        content: parsed.content,
                    });
                }
            } catch (error) {
                alert(error instanceof Error ? error.message : '文件上传失败');
                return;
            } finally {
                setIsUploading(false);
            }
        }

        let displayText = rawText.trim();
        let content = rawText.trim();

        if (parsedAttachments.length > 0) {
            const labels = parsedAttachments
                .map((attachment) => (attachment.isImage ? `[图片: ${attachment.name}]` : `[文件: ${attachment.name}]`))
                .join('\n');
            const fileContents = parsedAttachments
                .map((attachment) => `${attachment.isImage ? '图片内容' : '文件内容'} - ${attachment.name}\n${attachment.content || ''}`)
                .join('\n\n');
            displayText = displayText ? `${labels}\n${displayText}` : labels;
            content = `${labels}\n\n${fileContents}${content ? `\n\n用户补充：${content}` : ''}`;
            clearAttachments();
        }

        if (wfState && wfState.currentStep > 0 && wfState.stepOutputs[wfState.currentStep - 1]) {
            content = `上一步输出：\n${wfState.stepOutputs[wfState.currentStep - 1]}\n\n当前用户消息：\n${content}`;
        }

        const createConversationPromise = !conversationId ? createConversation(botId) : null;

        setMessages((current) => [
            ...current,
            { id: `user-${Date.now()}`, role: 'user', content: displayText },
        ]);
        setInputText('');
        setSuggestions([]);
        setIsStreaming(true);
        setStreamingText('');

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
                inputType: hasFiles ? 'file' : 'text',
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

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                for (const line of chunk.split('\n')) {
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
                        } else if (event.type === 'error') {
                            throw new Error(event.content || 'AI 回复失败');
                        }
                    } catch (error) {
                        if (error instanceof SyntaxError) continue;
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

            if (shouldRefreshConversation && activeConversationId) {
                void refreshConversation(activeConversationId, { syncMessages: false }).catch((error) => {
                    console.error('[Chat] refresh conversation failed', error);
                });
            }
        }
    };

    const startNewConversation = () => {
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
            const nextFiles = files.slice(0, availableSlots).map((file) => {
                const ext = file.name.split('.').pop()?.toLowerCase() || '';
                const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
                return {
                    file,
                    name: file.name,
                    previewUrl: isImage ? URL.createObjectURL(file) : null,
                    isImage,
                };
            });

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

    const assistantMessages = messages.filter((message) => message.role === 'assistant' && message.id !== 'welcome');
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
                                <div className={styles.msgContent} dangerouslySetInnerHTML={{ __html: message.html }} />
                                {wfState && message.role === 'assistant' && message.id !== 'welcome' && (
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

            {suggestions.length > 0 && !isStreaming && (
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
                                    <img src={file.previewUrl} alt={file.name} className={styles.attachThumb} />
                                ) : (
                                    <span className={styles.attachIcon}><FileText size={18} /></span>
                                )}
                                <span className={styles.attachName}>{file.name}</span>
                                <button className={styles.attachRemove} onClick={() => removeAttachment(index)}>✕</button>
                            </div>
                        ))}
                    </div>
                )}
                <div className={styles.inputWrapper}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.docx,.txt,.md,.csv,.pptx,.jpg,.jpeg,.png,.gif,.webp"
                        onChange={handleFileUpload}
                        style={{ display: 'none' }}
                    />
                    <button
                        className={styles.toolBtn}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isStreaming || isUploading}
                        title="上传文件"
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
                        placeholder={isTranscribing ? '语音转录中，请稍候...' : '输入消息...'}
                        className={styles.textInput}
                        rows={1}
                        disabled={isStreaming || isUploading}
                    />
                    <button
                        onClick={() => void sendMessage(inputText)}
                        className={styles.sendBtn}
                        disabled={(!inputText.trim() && attachedFiles.length === 0) || isStreaming || isTranscribing || isUploading}
                    >
                        <Send size={18} />
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



