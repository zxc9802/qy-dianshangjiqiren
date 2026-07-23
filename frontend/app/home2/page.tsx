'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useAuthStore } from '../stores/auth';
import { useConversationsStore } from '../stores/conversations';
import {
  BUILTIN_BOTS,
  GENERIC_CHAT_BOT_ID,
  QIYA_ENTERPRISE_MANAGEMENT_BOT_ID,
  VIDEO_BREAKDOWN_BOT_ID,
} from '../lib/builtin-bots';
import {
  DEFAULT_RESPONSE_MODEL,
  DEFAULT_WEB_SEARCH_MODE,
  RESPONSE_MODEL_OPTIONS,
  RESPONSE_MODEL_STORAGE_PREFIX,
  WEB_SEARCH_MODE_OPTIONS,
  WEB_SEARCH_MODE_STORAGE_PREFIX,
  isSelectableResponseModel,
  isWebSearchMode,
  type ResponseModel,
  type WebSearchMode,
} from '../lib/chat-models';
import { putLaunchChatDraft } from '../lib/launch-chat-drafts';
import { VIDEO_SITE_METADATA, type VideoSiteKey } from '../lib/video-sites';
import { startPcm16kMonoRecorder, type Pcm16Recorder } from '../lib/pcmRecorder';
import { api, type ExternalSsoProduct } from '../lib/api';
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  ChevronDown,
  FileText,
  ImageIcon,
  Loader2,
  Menu,
  MessageSquare,
  Mic,
  Moon,
  Paperclip,
  PenTool,
  Search,
  Send,
  Sprout,
  Star,
  Sun,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import styles from './page.module.css';

type DemoBot = {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: ReactNode;
  iconColor: string;
  path?: string;
  ssoProduct?: ExternalSsoProduct;
  requiresAuth: boolean;
  videoSite?: VideoSiteKey;
};

const MAX_ATTACHMENTS = 10;
const ATTACHMENT_ACCEPT = '.pdf,.docx,.txt,.md,.csv,.pptx,.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.webm,.m4v';

const builtin = (routeId: string) => BUILTIN_BOTS.find((bot) => bot.routeId === routeId);

const FEATURED_BOTS: DemoBot[] = [
  {
    id: 'kb-chat',
    name: '起芽知识库机器人',
    category: '管理工具',
    description: '连接企业知识与资料，快速获得内部知识问答和可执行结论。',
    icon: <BookOpen size={22} strokeWidth={1.8} />,
    iconColor: '#16877c',
    path: '/bot/kb-chat?autostart=1&openMode=replace',
    requiresAuth: true,
  },
  {
    id: QIYA_ENTERPRISE_MANAGEMENT_BOT_ID,
    name: builtin(QIYA_ENTERPRISE_MANAGEMENT_BOT_ID)?.name || '起芽成长特助',
    category: '管理工具',
    description: builtin(QIYA_ENTERPRISE_MANAGEMENT_BOT_ID)?.description || '围绕 SOP、OKR、KPI 和职场成长给出落地建议。',
    icon: <Sprout size={22} strokeWidth={1.8} />,
    iconColor: '#23a65a',
    path: `/chat/${QIYA_ENTERPRISE_MANAGEMENT_BOT_ID}`,
    requiresAuth: true,
  },
  {
    id: 'copywriting-agent',
    name: '老黄 AI 文案总控',
    category: '电商工具',
    description: '统一管理案例、素材和内容表现，让文案生产更快形成闭环。',
    icon: <PenTool size={22} strokeWidth={1.8} />,
    iconColor: '#e35b52',
    path: '/bot/copywriting-agent?autostart=1&openMode=replace',
    requiresAuth: true,
  },
  {
    id: 'sales-conversion-agent',
    name: '销转智能体',
    category: '电商工具',
    description: '进入销转智能体，围绕销售转化问题获取针对性建议。',
    icon: <MessageSquare size={22} strokeWidth={1.8} />,
    iconColor: '#c96a31',
    ssoProduct: 'xiaoshou',
    requiresAuth: true,
  },
  {
    id: 'viral-copy-rewrite-agent',
    name: '爆款改写智能体',
    category: '电商工具',
    description: '进入爆款改写智能体，快速优化商品文案与内容表达。',
    icon: <PenTool size={22} strokeWidth={1.8} />,
    iconColor: '#b84965',
    ssoProduct: 'baokuangaixie',
    requiresAuth: true,
  },
  {
    id: 'sabc-project-rating-agent',
    name: 'SABC项目评级智能体',
    category: '电商工具',
    description: '进入 SABC 项目评级智能体，完成项目评估与分级分析。',
    icon: <Star size={22} strokeWidth={1.8} />,
    iconColor: '#6d57ba',
    ssoProduct: 'sabc',
    requiresAuth: true,
  },
  {
    id: VIDEO_BREAKDOWN_BOT_ID,
    name: builtin(VIDEO_BREAKDOWN_BOT_ID)?.name || '视频拆解导演',
    category: '电商工具',
    description: '从选题、镜头、节奏、口播和转化设计拆解视频，提炼可复制方法。',
    icon: <Video size={22} strokeWidth={1.8} />,
    iconColor: '#e35b52',
    path: `/chat/${VIDEO_BREAKDOWN_BOT_ID}`,
    requiresAuth: true,
  },
  {
    id: 'xiaohongshu-auto-generation',
    name: '小红书图文自动生成',
    category: '小红书',
    description: '进入小红书图文自动生成工具，完成内容生成与发布素材制作。',
    icon: <BookOpen size={22} strokeWidth={1.8} />,
    iconColor: '#e35b52',
    ssoProduct: 'xhstw',
    requiresAuth: true,
  },
  {
    id: 'buyer-show',
    name: '买家秀智能体',
    category: '绘图机器人',
    description: '按主站账号保存生成历史，辅助完成买家秀内容与评论草稿。',
    icon: <ImageIcon size={22} strokeWidth={1.8} />,
    iconColor: '#1d8c82',
    path: '/bot/buyer-show?autostart=1&openMode=replace',
    requiresAuth: true,
  },
  {
    id: 'detail-image-agent',
    name: '店铺图片工具',
    category: '绘图机器人',
    description: '从商品素材到多场景电商图，支持历史复用与二次生成。',
    icon: <ImageIcon size={22} strokeWidth={1.8} />,
    iconColor: '#1697b7',
    path: '/bot/detail-image-agent?autostart=1&openMode=replace',
    requiresAuth: true,
  },
  {
    id: 'video-workbench',
    name: '视频工作台',
    category: '视频工作台',
    description: '进入视频生成工作台，集中处理参数、预览和生成历史。',
    icon: <Video size={22} strokeWidth={1.8} />,
    iconColor: '#c68a23',
    path: VIDEO_SITE_METADATA.seedance.entryPath,
    requiresAuth: true,
    videoSite: 'seedance',
  },
];

const QUICK_PROMPTS = ['提炼商品卖点', '写 10 个小红书标题', '分析竞品差异', '生成主图方案'];

function attachmentKind(file: File): 'document' | 'image' | 'video' {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
  return 'document';
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export default function Home2Page() {
  const { user, isAuthenticated, isLoading, loadUser } = useAuthStore();
  const { conversations, favorites, loadConversations, toggleFavorite, removeFavorite, deleteConversation } = useConversationsStore();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'history' | 'favorites'>('history');
  const [searchQuery, setSearchQuery] = useState('');
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [responseModel, setResponseModel] = useState<ResponseModel>(DEFAULT_RESPONSE_MODEL);
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>(DEFAULT_WEB_SEARCH_MODE);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<Pcm16Recorder | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => { void loadUser(); }, [loadUser]);
  useEffect(() => {
    if (!isAuthenticated) return;
    void loadConversations().catch((error) => console.error('[Home2] Failed to load conversations', error));
  }, [isAuthenticated, loadConversations]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedModel = window.localStorage.getItem(`${RESPONSE_MODEL_STORAGE_PREFIX}${GENERIC_CHAT_BOT_ID}`);
    const savedSearch = window.localStorage.getItem(`${WEB_SEARCH_MODE_STORAGE_PREFIX}${GENERIC_CHAT_BOT_ID}`);
    if (isSelectableResponseModel(savedModel)) setResponseModel(savedModel);
    if (isWebSearchMode(savedSearch)) setWebSearchMode(savedSearch);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(`${RESPONSE_MODEL_STORAGE_PREFIX}${GENERIC_CHAT_BOT_ID}`, responseModel);
    window.localStorage.setItem(`${WEB_SEARCH_MODE_STORAGE_PREFIX}${GENERIC_CHAT_BOT_ID}`, webSearchMode);
  }, [responseModel, webSearchMode]);
  useEffect(() => () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) void recorder.stop().catch(() => undefined);
  }, []);

  const requireAuth = useCallback((path: string) => {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(path)}`);
      return false;
    }
    router.push(path);
    return true;
  }, [isAuthenticated, router]);

  const filteredBots = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return FEATURED_BOTS;
    return FEATURED_BOTS.filter((bot) => `${bot.name} ${bot.description}`.toLowerCase().includes(query));
  }, [searchQuery]);

  const botGroups = useMemo(() => {
    const categoryOrder = ['管理工具', '电商工具', '小红书', '绘图机器人', '视频工作台'];
    return categoryOrder
      .map((category) => ({ category, bots: filteredBots.filter((bot) => bot.category === category) }))
      .filter((group) => group.bots.length > 0);
  }, [filteredBots]);

  const sidebarConversations = useMemo(
    () => (sidebarTab === 'favorites' ? favorites : conversations).slice().sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, favorites, sidebarTab],
  );

  const submitPrompt = useCallback(async (nextPrompt = prompt) => {
    const text = nextPrompt.trim();
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!text && attachments.length === 0) return;

    try {
      const draft = await putLaunchChatDraft({ prompt: text, files: attachments });
      setPrompt('');
      setAttachments([]);
      router.push(`/chat/${GENERIC_CHAT_BOT_ID}?rm=${encodeURIComponent(responseModel)}&ws=${encodeURIComponent(webSearchMode)}&ld=${encodeURIComponent(draft.id)}`);
    } catch (error) {
      alert(error instanceof Error ? error.message : '消息暂存失败，请重试');
    }
  }, [attachments, isAuthenticated, prompt, responseModel, router, webSearchMode]);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const available = MAX_ATTACHMENTS - attachments.length;
    if (available <= 0) {
      alert(`一次最多上传 ${MAX_ATTACHMENTS} 个文件`);
      return;
    }
    setAttachments((current) => [...current, ...files.slice(0, available)]);
    if (files.length > available) alert(`一次最多上传 ${MAX_ATTACHMENTS} 个文件，其余文件已忽略`);
  }, [attachments.length]);

  const toggleVoice = useCallback(async () => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
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
        formData.append('audio', audioBlob, 'homepage-recording.wav');
        const response = await fetch('/api/voice', { method: 'POST', body: formData });
        const data = await response.json();
        const transcript = typeof data.text === 'string' ? data.text.trim() : '';
        if (!transcript) throw new Error(data.error || '语音识别失败');
        await submitPrompt(transcript);
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
  }, [isAuthenticated, isRecording, router, submitPrompt]);

  const openBot = useCallback(async (bot: DemoBot) => {
    if (bot.ssoProduct) {
      if (!isAuthenticated) {
        router.push(`/login?redirect=${encodeURIComponent('/home2')}`);
        return;
      }
      try {
        const result = await api.startExternalSso(bot.ssoProduct);
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } catch (error) {
        alert(error instanceof Error ? error.message : '无法打开智能体，请稍后重试');
      }
      return;
    }
    if (!bot.path) return;
    if (bot.videoSite) {
      const launchPath = `${bot.path}?autostart=1`;
      if (!isAuthenticated) {
        router.push(`/login?redirect=${encodeURIComponent(launchPath)}`);
        return;
      }
      try {
        const result = await api.startVideoSso({ site: bot.videoSite });
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } catch {
        router.push(launchPath);
      }
      return;
    }
    requireAuth(bot.path);
  }, [isAuthenticated, requireAuth, router]);

  if (isLoading) return <div className={styles.loading}><div className={styles.loadingMark}>Q</div></div>;

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.iconButton} onClick={() => setSidebarOpen((open) => !open)} aria-label="打开侧栏"><Menu size={20} /></button>
          <div className={styles.brandMark}><Bot size={18} /></div>
          <div>
            <div className={styles.brandName}>电商 AI 智能平台</div>
            <div className={styles.brandSubline}>精选工作台 · 11</div>
          </div>
        </div>
        <div className={styles.headerSearch}>
          <Search size={16} />
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索精选入口..." aria-label="搜索精选入口" />
          <span>⌘K</span>
        </div>
        <nav className={styles.headerNav} aria-label="主导航">
          <button onClick={() => requireAuth('/my-bots')}>我的智能体</button>
          {user?.role === 'admin' && <button onClick={() => requireAuth('/admin/invite-codes')}>邀请码管理</button>}
          <button onClick={() => requireAuth('/insights')}>网页洞察</button>
          {mounted && <button className={styles.themeButton} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="切换主题">{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>}
          {isAuthenticated ? <button className={styles.avatar} onClick={() => router.push('/profile')}>{user?.nickname?.slice(0, 1) || '我'}</button> : <button onClick={() => router.push('/login')}>登录</button>}
        </nav>
      </header>

      <div className={styles.body}>
        <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
          <div className={styles.sidebarHeader}>
            <div>
              <span className={styles.eyebrow}>YOUR DESK</span>
              <h2>最近工作</h2>
            </div>
            <button className={styles.iconButton} onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏"><X size={18} /></button>
          </div>
          <div className={styles.sidebarTabs}>
            <button className={sidebarTab === 'history' ? styles.sidebarTabActive : ''} onClick={() => setSidebarTab('history')}><MessageSquare size={14} />聊天记录</button>
            <button className={sidebarTab === 'favorites' ? styles.sidebarTabActive : ''} onClick={() => setSidebarTab('favorites')}><Star size={14} />收藏</button>
          </div>
          {user?.role === 'admin' && (
            <button className={styles.adminShortcut} onClick={() => requireAuth('/admin/invite-codes')}>
              <span>邀请码管理</span>
              <ArrowUpRight size={17} strokeWidth={1.8} />
            </button>
          )}
          <div className={styles.sidebarList}>
            {sidebarConversations.length === 0 ? <p className={styles.sidebarEmpty}>{sidebarTab === 'favorites' ? '还没有收藏' : '登录后查看最近对话'}</p> : sidebarConversations.map((conversation) => {
              const lastMessage = conversation.messages[conversation.messages.length - 1];
              return (
                <div key={conversation.id} className={styles.sidebarItem} onClick={() => router.push(`/chat/${conversation.botId}?cid=${conversation.id}`)}>
                  <div className={styles.sidebarItemTop}><strong>{conversation.botName || '机器人'}</strong><time>{formatTime(conversation.updatedAt)}</time></div>
                  <p>{lastMessage?.content.replace(/\[文件:.*?\]/g, '[文件]').slice(0, 42) || '打开对话继续工作'}</p>
                  <div className={styles.sidebarActions}>
                    {sidebarTab === 'history' && <button onClick={(event) => { event.stopPropagation(); void toggleFavorite(conversation.id); }} aria-label="收藏"><Star size={14} fill={conversation.isFavorite ? 'currentColor' : 'none'} /></button>}
                    <button onClick={(event) => { event.stopPropagation(); void (sidebarTab === 'favorites' ? removeFavorite(conversation.id) : deleteConversation(conversation.id)); }} aria-label="删除"><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <main className={styles.main}>
          <section className={styles.hero}>
            <div className={styles.heroKicker}><span className={styles.kickerDot} /> OPERATING DESK <span>／</span> 电商增长</div>
            <h1><span>{user?.nickname ? `${user.nickname}，` : ''}今天</span>先推进一件事。</h1>
            <p>把问题、素材或视频交给我，从一个清晰的动作开始。</p>

            <div className={styles.composerShell}>
              <input ref={fileInputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} onChange={handleFileUpload} hidden />
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submitPrompt();
                  }
                }}
                placeholder={isTranscribing ? '正在把语音变成文字…' : '输入问题，或拖入商品图、文档、视频…'}
                rows={3}
                disabled={isTranscribing}
              />
              {attachments.length > 0 && <div className={styles.attachmentList}>{attachments.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className={styles.attachmentChip}><span>{attachmentKind(file) === 'image' ? <ImageIcon size={13} /> : attachmentKind(file) === 'video' ? <Video size={13} /> : <FileText size={13} />}</span><strong>{file.name}</strong><button onClick={() => setAttachments((current) => current.filter((_, fileIndex) => fileIndex !== index))} aria-label={`移除 ${file.name}`}><X size={12} /></button></div>)}</div>}
              <div className={styles.composerFooter}>
                <button className={styles.attachButton} onClick={() => fileInputRef.current?.click()} disabled={isRecording || isTranscribing}><Paperclip size={15} />{attachments.length ? `已选 ${attachments.length} 个附件` : '添加素材'}</button>
                <div className={styles.composerControls}>
                  <label className={styles.selectWrap}><select value={responseModel} onChange={(event) => { if (isSelectableResponseModel(event.target.value)) setResponseModel(event.target.value); }} disabled={isRecording || isTranscribing} aria-label="回答模型">{RESPONSE_MODEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={14} /></label>
                  <label className={styles.selectWrap}><select value={webSearchMode} onChange={(event) => { if (isWebSearchMode(event.target.value)) setWebSearchMode(event.target.value); }} disabled={isRecording || isTranscribing} aria-label="联网模式">{WEB_SEARCH_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={14} /></label>
                  <button className={`${styles.roundButton} ${isRecording ? styles.recording : ''}`} onClick={() => void toggleVoice()} disabled={isTranscribing} aria-label={isRecording ? '停止录音' : '语音输入'}>{isTranscribing ? <Loader2 size={17} className={styles.spin} /> : <Mic size={17} />}</button>
                  <button className={styles.sendButton} onClick={() => void submitPrompt()} disabled={isRecording || isTranscribing || (!prompt.trim() && attachments.length === 0)} aria-label="发送"><Send size={17} /></button>
                </div>
              </div>
            </div>

            <div className={styles.quickPrompts}>{QUICK_PROMPTS.map((quickPrompt) => <button key={quickPrompt} onClick={() => { setPrompt(quickPrompt); promptRef.current?.focus(); }}>{quickPrompt}<ArrowUpRight size={13} /></button>)}</div>
          </section>

          <section className={styles.toolsSection}>
            <div className={styles.sectionIntro}><div><span className={styles.eyebrow}>CURATED TOOLS</span><h2>精选入口</h2></div><p>当前只展示最常用的 11 个电商工作入口</p></div>
            {botGroups.map((group) => <div className={styles.category} key={group.category}><div className={styles.categoryHeading}><h3>{group.category}</h3><span>{String(group.bots.length).padStart(2, '0')}</span></div><div className={styles.botGrid}>{group.bots.map((bot, index) => <button key={bot.id} className={styles.botCard} style={{ '--card-index': index } as CSSProperties} onClick={() => void openBot(bot)}><span className={styles.botIcon} style={{ color: bot.iconColor, backgroundColor: `${bot.iconColor}15` }}>{bot.icon}</span><span className={styles.botInfo}><span className={styles.botTitleRow}><strong>{bot.name}</strong><em>正式版</em></span><small>{bot.description}</small></span><ArrowUpRight className={styles.botArrow} size={17} /></button>)}</div></div>)}
            {filteredBots.length === 0 && <div className={styles.emptyState}><Search size={18} /><p>没有找到匹配的精选入口</p><button onClick={() => setSearchQuery('')}>清除搜索</button></div>}
          </section>
        </main>
      </div>

      <div className={styles.mobileNav}><button className={styles.mobileNavActive} onClick={() => router.push('/')}><Bot size={19} />精选</button><button onClick={() => requireAuth('/my-bots')}><SparklesIcon /><span>我的</span></button><button onClick={() => requireAuth('/insights')}><Search size={19} /><span>洞察</span></button><button onClick={() => router.push('/profile')}><span className={styles.mobileUserDot}>{user?.nickname?.slice(0, 1) || '我'}</span><span>账户</span></button></div>
    </div>
  );
}

function SparklesIcon() {
  return <span className={styles.sparklesIcon}>✦</span>;
}
