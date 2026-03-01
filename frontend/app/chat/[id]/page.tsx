'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../../stores/auth';
import { useConversationsStore } from '../../stores/conversations';
import { startPcm16kMonoRecorder, type Pcm16Recorder } from '../../lib/pcmRecorder';
import styles from './chat.module.css';

interface MessageItem {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

const BOT_NAMES: Record<string, string> = {
    '1': 'KPI教练', '2': 'SOP梳理AI教练', '3': 'OKR教练',
    '4': '电商商业顾问', '5': '招聘教练', '6': 'AI通用助手',
    '7': '一键出10图提示词', '8': '天猫爆款趋势拆解', '9': '卖点教练',
    '10': '天猫主图策划教练', '11': '爆款裂变分析AI教练', '12': '天猫评价教练',
    '13': '天猫竞争策略教练', '14': '天猫客单价提升教练',
    '15': '小红书爆文封面拆解', '16': '小红书私域搭建SOP', '17': '小红书爆文拆解复制',
    '18': '小红书爆款标题', '19': '小红书起号话题', '20': '小红书达人SOP流程',
    '21': '小红书正文拆解SOP', '22': '小红书笔记评论生成',
    '23': '毛泽东战略智能体', '24': '乔布斯产品教练', '25': '张一鸣商业教练',
    '26': '降税模型测算', '27': '股权架构设计', '28': '电商平台专项合规',
    '29': '薪酬与个税规划', '30': '预警诊断&稽查',
    '31': 'AI工作流开发需求细化', '32': '调研访谈—高价值场景',
    '33': '火火提示词调试', '34': 'AI工作流访谈教练',
};

const BOT_WELCOMES: Record<string, string> = {
    '1': '你好，你们团队现在是怎么做绩效考核的？',
    '2': '你好，你想梳理哪个环节的流程？',
    '3': '你好，你们今年最重要的目标是什么？',
    '4': '你好，聊聊你现在遇到的问题吧。',
    '5': '你好，最近在招什么岗位？',
    '6': '你好，说说你的需求。',
    '7': '你好，你的产品是什么？',
    '8': '你好，你想看哪个品类的趋势？',
    '9': '你好，你的产品是什么？',
    '10': '你好，你的产品是什么？目前主图点击率怎么样？',
    '11': '你好，你想复制哪个爆款的打法？',
    '12': '你好，你是什么品类的？',
    '13': '你好，你想分析哪个竞品？',
    '14': '你好，你目前客单价多少？卖什么品类的？',
    '15': '你好，把爆文封面发过来看看。',
    '16': '你好，你目前小红书粉丝量级多少？',
    '17': '你好，把想拆解的爆文发过来。',
    '18': '你好，你做什么方向的内容？',
    '19': '你好，你的账号定位和目标人群是什么？',
    '20': '你好，你的产品是什么？预算大概多少？',
    '21': '你好，把想拆解的爆文发过来。',
    '22': '你好，你是什么产品？想营造什么样的评论氛围？',
    '23': '你好，说说你现在面对的挑战。',
    '24': '你好，你的产品解决的是什么问题？',
    '25': '你好，你想分析什么问题？',
    '26': '你好，你的企业类型和年营收大概多少？',
    '27': '你好，你们目前几个合伙人？股权怎么分的？',
    '28': '你好，你在哪个平台经营？',
    '29': '你好，你们团队多少人？现在薪酬结构是怎样的？',
    '30': '你好，说说你担心的税务问题。',
    '31': '你好，你想用AI解决什么业务场景？',
    '32': '你好，你们是做什么业务的？',
    '33': '你好，把你的提示词发过来看看。',
    '34': '你好，说说你的业务流程。',
};

const BOT_PROMPTS: Record<string, string> = {
    '1': '你是一位拥有15年人力资源管理经验的KPI设计专家，专注电商行业绩效考核体系设计。通过对话了解用户的团队规模、岗位、考核需求，最终输出完整的KPI方案。',
    '2': '你是电商运营流程优化专家，帮助电商老板把经验变成标准操作流程(SOP)。通过对话了解业务环节，输出可执行的SOP文档。',
    '3': '你是OKR目标管理专家，帮助电商企业用OKR方法论对齐团队目标。引导用户明确使命愿景，拆解关键结果。',
    '4': '你是电商商业顾问，融合多位商业领袖思维，从市场、竞争、内部等多维度分析商业问题，给出战略建议。',
    '5': '你是电商行业招聘专家，从JD撰写到面试设计到入职SOP全流程指导。',
    '6': '你是智能通用助手，擅长写作、分析、翻译、计算和头脑风暴。',
    '7': '你是电商产品图AI出图提示词专家，根据产品特点输出10张不同场景的AI生图提示词（中英文对照）。需要了解产品类型、目标人群、使用场景和风格偏好。',
    '8': '你是天猫爆款趋势分析专家，用数据思维拆解爆款逻辑，分析市场趋势、价格带分布、人群画像。',
    '9': '你是卖点提炼专家，通过FAB法则和竞品对比帮用户找到产品的超级卖点。',
    '10': '你是天猫主图策划专家，5张主图=一个微型详情页，每张图都有明确的信息任务。',
    '11': '你是爆款裂变分析专家，把一个爆款的成功经验复制到新人群、新场景、新价格带。',
    '12': '你是天猫评价内容策划专家，设计高转化率的评价内容框架，好评也是销售话术。',
    '13': '你是天猫竞争策略专家，系统性分析竞争对手的产品、定价、流量、评价，找到竞争切入点。',
    '14': '你是天猫客单价提升专家，通过组合策略、价格锚定和关联销售提升客单价。',
    '15': '你是小红书爆文封面拆解专家，分析构图、色彩、文字排版和爆点元素。',
    '16': '你是小红书私域搭建专家，帮助合规引流，把公域流量导入微信私域。',
    '17': '你是小红书爆文拆解专家，逆向工程爆款笔记，提炼可复用的创作公式。',
    '18': '你是小红书爆款标题专家，深研10000+爆文标题规律，写出高点击标题。',
    '19': '你是小红书起号策略专家，帮新账号快速度过冷启动期。',
    '20': '你是小红书达人合作(KOL)专家，系统化的合作全流程从选号到复盘。',
    '21': '你是小红书正文拆解专家，分析爆款笔记正文的开头、结构、节奏和CTA。',
    '22': '你是小红书评论生成专家，评论区是第二个详情页，设计高互动率的评论内容。',
    '23': '你是战略分析师，用矛盾论、持久战、游击战术等思维框架分析商业问题。分析问题时先找主要矛盾，然后分析敌我力量对比。',
    '24': '你是产品思维教练，风格极致简约，追问本质。总是回到用户真正的问题，挑战用户的假设。',
    '25': '你是商业决策分析师，数据驱动、反直觉、延迟满足。用LTV/CAC、人效比等数据框架分析商业问题。',
    '26': '你是电商税务筹划专家，帮助企业通过合理架构设计降低综合税负。',
    '27': '你是股权架构设计专家，负责股权结构设计、控制权保护和融资规划。',
    '28': '你是电商平台合规专家，熟悉天猫京东拼多多各平台的税务合规要求。',
    '29': '你是薪酬与个税规划专家，设计合理的薪酬结构降低用工成本。',
    '30': '你是税务风险排查专家，帮助企业提前发现税务风险并准备应对预案。',
    '31': '你是AI需求分析师，帮助企业把模糊的AI想法细化成可执行的需求文档。',
    '32': '你是AI场景挖掘专家，通过结构化访谈发现企业中高价值的AI应用场景。',
    '33': '你是AI提示词调试专家，帮用户编写、调试和优化提示词，让AI输出更精准。',
    '34': '你是AI工作流设计专家，找到业务流程中最值得用AI改造的关键场景。',
};

export default function ChatPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const botId = params.id as string;
    const { user } = useAuthStore();
    const { conversations, saveConversation, getConversation, loadConversations, deleteConversation } = useConversationsStore();

    // Per-bot sidebar and bot switcher state
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [botSwitcherOpen, setBotSwitcherOpen] = useState(false);

    const botName = BOT_NAMES[botId] || 'AI助手';
    const welcomeMsg = BOT_WELCOMES[botId] || '你好，说说你的需求。';

    // Load existing conversation or start new
    const convIdRef = useRef(searchParams.get('cid') || `conv-${botId}-${Date.now()}`);

    const [messages, setMessages] = useState<MessageItem[]>(() => {
        if (typeof window !== 'undefined') {
            const cid = searchParams.get('cid');
            if (cid) {
                loadConversations();
                const existing = getConversation(cid);
                if (existing && existing.messages.length > 0) {
                    return existing.messages.map(m => ({
                        id: m.id,
                        role: m.role,
                        content: m.content,
                    }));
                }
            }
        }
        return [{ id: 'welcome', role: 'assistant', content: welcomeMsg }];
    });
    const [inputText, setInputText] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => { scrollToBottom(); }, [messages, streamingText, scrollToBottom]);

    // Auto-save conversation after messages change
    useEffect(() => {
        if (messages.length > 1) {
            saveConversation({
                id: convIdRef.current,
                botId,
                botName,
                messages: messages.map(m => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    timestamp: Date.now(),
                })),
                isFavorite: false,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }
    }, [messages, botId, botName, saveConversation]);

    const sendMessage = async (text: string) => {
        const hasFile = !!attachedFile;
        if ((!text.trim() && !hasFile) || isStreaming) return;

        // Combine file content with user text
        let finalText = text.trim();
        if (attachedFile) {
            const filePrefix = `[文件: ${attachedFile.name}]\n\n${attachedFile.content}`;
            finalText = finalText ? `${filePrefix}\n\n用户追问: ${finalText}` : filePrefix;
            removeAttachment();
        }

        const userMsg: MessageItem = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: finalText,
        };

        const newMessages = [...messages, userMsg];
        setMessages(newMessages);
        setInputText('');
        setSuggestions([]);
        setIsStreaming(true);
        setStreamingText('');

        try {
            // Build conversation history (skip welcome message ID)
            const history = newMessages.map(m => ({
                role: m.role,
                content: m.content,
            }));

            const systemPrompt = BOT_PROMPTS[botId] || '你是一个AI助手。';

            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ botId, systemPrompt, messages: history }),
            });

            if (!res.ok) {
                throw new Error('API 请求失败');
            }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

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
                            setStreamingText(fullText);
                        } else if (event.type === 'error') {
                            throw new Error(event.content || 'AI 回复失败');
                        }
                    } catch (e) {
                        if (e instanceof SyntaxError) continue;
                        throw e;
                    }
                }
            }

            // Extract suggestions JSON from the end of response
            let cleanText = fullText;
            const sugMatch = cleanText.match(/```json[\s\S]*?(\{"suggestions":\s*\[.*?\]\})[\s\S]*?```/);
            if (sugMatch) {
                try {
                    const parsed = JSON.parse(sugMatch[1]);
                    if (parsed.suggestions) setSuggestions(parsed.suggestions);
                    cleanText = cleanText.replace(sugMatch[0], '').trim();
                } catch { /* ignore */ }
            }

            setMessages(prev => [...prev, {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: cleanText,
            }]);
            setStreamingText('');
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : '发送失败';
            setMessages(prev => [...prev, {
                id: `err-${Date.now()}`,
                role: 'assistant',
                content: `出错了: ${errMsg}`,
            }]);
            setStreamingText('');
        } finally {
            setIsStreaming(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(inputText);
        }
    };

    // File upload handler
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [attachedFile, setAttachedFile] = useState<{
        name: string;
        content: string;
        previewUrl: string | null;
        isImage: boolean;
    } | null>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';

        // Generate preview URL for images
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const isImage = imageExts.includes(ext);
        let previewUrl: string | null = null;
        if (isImage) {
            previewUrl = URL.createObjectURL(file);
        }

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();

            if (data.error) {
                alert(data.error);
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                return;
            }

            setAttachedFile({
                name: data.fileName,
                content: data.content,
                previewUrl,
                isImage,
            });
        } catch {
            alert('文件上传失败，请重试');
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        } finally {
            setIsUploading(false);
        }
    };

    const removeAttachment = () => {
        if (attachedFile?.previewUrl) URL.revokeObjectURL(attachedFile.previewUrl);
        setAttachedFile(null);
    };

    // Voice input (ByteDance ASR via /api/voice)
    const [isRecording, setIsRecording] = useState(false);
    const pcmRecorderRef = useRef<Pcm16Recorder | null>(null);

    const toggleVoice = async () => {
        if (isRecording) {
            setIsRecording(false);
            const recorder = pcmRecorderRef.current;
            pcmRecorderRef.current = null;
            if (!recorder) return;

            try {
                const audioBlob = await recorder.stop();
                if (audioBlob.size < 1000) return;

                const formData = new FormData();
                formData.append('audio', audioBlob, 'recording.wav');
                const res = await fetch('/api/voice', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.text) {
                    setInputText(prev => prev + data.text);
                } else if (data.error) {
                    alert('语音识别失败: ' + data.error);
                }
            } catch {
                alert('语音识别请求失败');
            }
            return;
        }

        try {
            pcmRecorderRef.current = await startPcm16kMonoRecorder();
            setIsRecording(true);
        } catch {
            alert('无法访问麦克风，请检查浏览器权限');
        }
    };

    // Per-bot conversation history
    const botConversations = conversations
        .filter(c => c.botId === botId)
        .sort((a, b) => b.updatedAt - a.updatedAt);

    const formatHistoryTime = (ts: number) => {
        const d = new Date(ts);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    };

    const startNewConversation = () => {
        convIdRef.current = `conv-${botId}-${Date.now()}`;
        setMessages([{ id: 'welcome', role: 'assistant', content: welcomeMsg }]);
        setInputText('');
        setSuggestions([]);
        setStreamingText('');
        setIsStreaming(false);
        setSidebarOpen(false);
    };

    // All bot names for bot switcher
    const allBots = Object.entries(BOT_NAMES).map(([id, name]) => ({ id, name }));

    return (
        <div className={styles.layout}>
            {/* Per-bot history sidebar */}
            <aside className={`${styles.chatSidebar} ${sidebarOpen ? styles.chatSidebarOpen : ''}`}>
                <div className={styles.chatSidebarHeader}>
                    <h3 className={styles.chatSidebarTitle}>💬 {botName} 对话记录</h3>
                </div>
                <div className={styles.chatSidebarList}>
                    {botConversations.length === 0 ? (
                        <div className={styles.chatSidebarEmpty}>暂无对话记录</div>
                    ) : botConversations.map(conv => (
                        <div
                            key={conv.id}
                            className={`${styles.chatSidebarItem} ${conv.id === convIdRef.current ? styles.chatSidebarItemActive : ''}`}
                            onClick={() => { router.push(`/chat/${botId}?cid=${conv.id}`); window.location.reload(); }}
                        >
                            <p className={styles.chatSidebarPreview}>
                                {conv.messages[conv.messages.length - 1]?.content.slice(0, 30) || '新对话'}
                            </p>
                            <span className={styles.chatSidebarTime}>{formatHistoryTime(conv.updatedAt)}</span>
                            <button className={styles.chatSidebarDel} onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}>🗑️</button>
                        </div>
                    ))}
                </div>
            </aside>

            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <button onClick={() => router.push('/')} className={styles.backBtn}>← 返回</button>
                    <button onClick={startNewConversation} className={styles.newChatBtn}>+ 新对话</button>
                </div>
                <div className={styles.headerRight}>
                    <button onClick={() => setSidebarOpen(!sidebarOpen)} className={styles.historyBtn}>📋 历史记录</button>
                    <div className={styles.botSwitcher}>
                        <h2 className={styles.botName} onClick={() => setBotSwitcherOpen(!botSwitcherOpen)}>
                            {botName} <span className={styles.switchArrow}>▾</span>
                        </h2>
                        {botSwitcherOpen && (
                            <div className={styles.switcherDropdown}>
                                <div className={styles.switcherList}>
                                    {allBots.map(bot => (
                                        <button
                                            key={bot.id}
                                            className={`${styles.switcherItem} ${bot.id === botId ? styles.switcherItemActive : ''}`}
                                            onClick={() => { setBotSwitcherOpen(false); router.push(`/chat/${bot.id}`); }}
                                        >
                                            {bot.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <span className={styles.pointsBadge}>{user?.pointsBalance ?? 0} 积分</span>
                </div>
            </header>

            <div className={styles.messagesContainer}>
                <div className={styles.messages}>


                    {messages.map(msg => (
                        <div
                            key={msg.id}
                            className={`${styles.message} ${msg.role === 'user' ? styles.userMsg : styles.assistantMsg}`}
                        >
                            <div className={styles.msgBubble}>
                                <div className={styles.msgContent} dangerouslySetInnerHTML={{
                                    __html: formatMessage(msg.content)
                                }} />
                            </div>
                        </div>
                    ))}

                    {isStreaming && streamingText && (
                        <div className={`${styles.message} ${styles.assistantMsg}`}>
                            <div className={styles.msgBubble}>
                                <div className={styles.msgContent} dangerouslySetInnerHTML={{
                                    __html: formatMessage(streamingText)
                                }} />
                                <div className={styles.typingDot} />
                            </div>
                        </div>
                    )}

                    {isStreaming && !streamingText && (
                        <div className={`${styles.message} ${styles.assistantMsg}`}>
                            <div className={styles.msgBubble}>
                                <div className={styles.thinking}>
                                    <span /><span /><span />
                                </div>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            {suggestions.length > 0 && !isStreaming && (
                <div className={styles.suggestions}>
                    {suggestions.map((s, i) => (
                        <button
                            key={i}
                            className={styles.suggestionBtn}
                            onClick={() => sendMessage(s)}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            )}

            <div className={styles.inputBar}>
                {attachedFile && (
                    <div className={styles.attachmentBar}>
                        {attachedFile.isImage && attachedFile.previewUrl ? (
                            <img src={attachedFile.previewUrl} alt={attachedFile.name} className={styles.attachThumb} />
                        ) : (
                            <span className={styles.attachIcon}>📄</span>
                        )}
                        <span className={styles.attachName}>{attachedFile.name}</span>
                        <button className={styles.attachRemove} onClick={removeAttachment}>✕</button>
                    </div>
                )}
                {isUploading && (
                    <div className={styles.attachmentBar}>
                        <span className={styles.attachIcon}>⏳</span>
                        <span className={styles.attachName}>文件上传中...</span>
                    </div>
                )}
                <div className={styles.inputWrapper}>
                    <input
                        ref={fileInputRef}
                        type="file"
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
                        {isUploading ? '...' : '📎'}
                    </button>
                    <button
                        className={`${styles.toolBtn} ${isRecording ? styles.recording : ''}`}
                        onClick={toggleVoice}
                        disabled={isStreaming}
                        title={isRecording ? '停止录音' : '语音输入'}
                    >
                        🎤
                    </button>
                    <textarea
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="输入消息..."
                        className={styles.textInput}
                        rows={1}
                        disabled={isStreaming}
                    />
                    <button
                        onClick={() => sendMessage(inputText)}
                        className={styles.sendBtn}
                        disabled={(!inputText.trim() && !attachedFile) || isStreaming}
                    >
                        ➤
                    </button>
                </div>
            </div>
        </div>
    );
}




function formatMessage(text: string): string {
    let s = text;

    // Remove ```json suggestion blocks
    s = s.replace(/```json[\s\S]*?\{"suggestions":[\s\S]*?\}[\s\S]*?```/g, '');

    // Strip markdown headers (# ## ### etc) but keep the text
    s = s.replace(/^#{1,6}\s*/gm, '');

    // Collapse excessive blank lines (2+ empty lines → 1 empty line)
    s = s.replace(/\n{3,}/g, '\n\n');
    // Remove blank lines right before table rows
    s = s.replace(/\n\n+(\|)/g, '\n$1');

    // HTML-escape
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Bold
    s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Bullet lists: lines starting with * or - or •
    s = s.replace(/^[\*\-\u2022]\s+/gm, '• ');

    // Numbered lists: keep as-is but trim extra spaces
    s = s.replace(/^(\d+[\.\)\u3001])\s+/gm, '$1 ');

    // Remove --- separators
    s = s.replace(/^---+$/gm, '');

    // Parse tables without injecting <br> inside table tags.
    const lines = s.split('\n');
    const parts: string[] = [];
    let inTable = false;
    let pendingBreaks = 0;

    const flushBreaks = (maxBreaks = 2) => {
        const count = Math.min(pendingBreaks, maxBreaks);
        for (let i = 0; i < count; i++) {
            parts.push('<br>');
        }
        pendingBreaks = 0;
    };

    for (const line of lines) {
        const trimmed = line.trim();
        const isTableLine = trimmed.startsWith('|') && trimmed.includes('|');

        if (isTableLine) {
            const cells = trimmed.split('|').filter(c => c.trim()).map(c => c.trim());
            if (cells.every(c => /^[-:]+$/.test(c))) continue;

            if (!inTable) {
                // Keep table closer to preceding text.
                pendingBreaks = Math.min(pendingBreaks, 1);
                flushBreaks(1);
                parts.push('<table>');
                inTable = true;
            }

            parts.push('<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>');
            continue;
        }

        if (inTable) {
            parts.push('</table>');
            inTable = false;
            // Keep at least one break after table.
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

    const html = parts.join('')
        .replace(/^(<br>\s*)+/, '')
        .replace(/(<br>\s*)+$/, '');

    return html;
}
