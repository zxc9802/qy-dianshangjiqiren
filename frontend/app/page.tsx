'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useAuthStore } from './stores/auth';
import { useConversationsStore } from './stores/conversations';
import {
  BUILTIN_BOTS,
  BUILTIN_CATEGORY_ORDER,
  GENERIC_CHAT_BOT_ID,
  QIYA_ENTERPRISE_MANAGEMENT_BOT_ID,
} from './lib/builtin-bots';
import {
  DEFAULT_RESPONSE_MODEL,
  RESPONSE_MODEL_OPTIONS,
  RESPONSE_MODEL_STORAGE_PREFIX,
  type ResponseModel,
} from './lib/chat-models';
import { VIDEO_SITE_METADATA, type VideoSiteKey } from './lib/video-sites';
import { startPcm16kMonoRecorder, type Pcm16Recorder } from './lib/pcmRecorder';
import { api } from './lib/api';
import styles from './page.module.css';
import {
  Bot, Search, Sun, Moon, Home, Zap, ImageIcon, User, Trash2,
  Target, Compass, MapPin, Briefcase, Users, Sparkles, TrendingUp,
  FrameIcon, Star, Swords, Coins, Camera, Link,
  FileText, PenTool, Rocket, ClipboardList, Puzzle, MessageSquare,
  Flag, Smartphone, BarChart3, Calculator, GitBranch, Shield,
  Wallet, AlertTriangle, Settings, SearchIcon, FlaskConical, Brain,
  Package, BookOpen, Landmark, Menu, Plus, Sprout, ChevronDown, ChevronRight,
  Mic, Send, Loader2, Video,
} from 'lucide-react';

interface BotInfo {
  id: string;
  name: string;
  category: string;
  icon: ReactNode;
  iconColor: string;
  description: string;
  pointsPerUse: number;
  isTrial: boolean;
  path: string;
  requiresAuth: boolean;
  videoSite?: VideoSiteKey;
}

const WF_TEMPLATES = [
  {
    id: 'wf-1',
    name: '新品上架全流程',
    title: '爆款打造流水线',
    steps: [
      { botId: '9', botName: '卖点教练', instruction: '请帮我提炼这个产品的核心卖点' },
      { botId: '10', botName: '天猫主图策划教练', instruction: '基于卖点，帮我策划5张天猫主图方案' },
      { botId: '12', botName: '天猫评价教练', instruction: '基于产品卖点和主图，设计真实自然的评价模板' },
    ],
    displaySteps: ['卖点', '主图', '评价'],
    gradient: 'linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)',
  },
  {
    id: 'wf-3',
    name: '小红书内容矩阵',
    title: '小红书内容矩阵',
    steps: [
      { botId: '17', botName: '小红书爆文拆解复制', instruction: '拆解这个方向的爆文公式，提炼可复用元素' },
      { botId: '18', botName: '小红书爆款标题', instruction: '基于爆文分析，给出10个高点击率标题' },
      { botId: '21', botName: '小红书正文拆解SOP', instruction: '基于以上标题，按爆文公式写完整正文' },
      { botId: '22', botName: '小红书笔记评论生成', instruction: '基于内容，生成10条自然引导互动的评论' },
    ],
    displaySteps: ['爆文', '标题', '正文', '评论'],
    gradient: 'linear-gradient(135deg, #16a34a 0%, #4ade80 100%)',
  },
  {
    id: 'wf-2',
    name: '竞品全面分析',
    title: '竞品全面分析',
    steps: [
      { botId: '13', botName: '天猫竞争策略教练', instruction: '分析以下产品/类目的竞品优劣势' },
      { botId: '8', botName: '天猫爆款趋势拆解', instruction: '基于竞品分析，深入分析该品类趋势和机会' },
      { botId: '14', botName: '天猫客单价提升教练', instruction: '基于竞品和趋势分析，制定定价和客单价提升策略' },
    ],
    displaySteps: ['竞品', '趋势', '定价'],
    gradient: 'linear-gradient(135deg, #ea580c 0%, #fb923c 100%)',
  },
];

const IMAGE_TOOL: BotInfo = {
  id: 'image-generator',
  name: '电商图片生成机器人',
  category: '绘图机器人',
  description: '上传参考图，按参数一键生成 2K 电商图，支持历史复用与二次编辑。',
  icon: <ImageIcon size={22} />,
  iconColor: '#7c3aed',
  path: '/bot/image-generator',
  pointsPerUse: 0,
  isTrial: true,
  requiresAuth: false,
};

const VIDEO_WORKBENCH_TOOL: BotInfo = {
  id: 'video-workbench-trial',
  name: '视频工作台',
  category: '视频工作台',
  description: '登录后进入试用版视频工作台，直接体验视频生成参数面板、预览区和工作台式操作界面。',
  icon: <Video size={22} />,
  iconColor: '#c0841a',
  path: '/bot/video-workbench',
  pointsPerUse: 0,
  isTrial: true,
  requiresAuth: true,
};

const VIDEO_WORKBENCH_TOOLS: BotInfo[] = [
  {
    id: 'video-workbench-veo',
    name: 'VEO 视频工作台',
    category: '瑙嗛宸ヤ綔鍙?',
    description: '登录后进入 VEO 模型视频工作台，保留原有视频站入口。',
    icon: <Video size={22} />,
    iconColor: '#0f766e',
    path: VIDEO_SITE_METADATA.veo.entryPath,
    pointsPerUse: 0,
    isTrial: true,
    requiresAuth: true,
    videoSite: 'veo',
  },
  {
    id: 'video-workbench-seedance',
    name: 'Seedance 2.0 视频工作台',
    category: '瑙嗛宸ヤ綔鍙?',
    description: '登录后进入 Seedance 2.0 视频工作台，适合直接做 Seedance 模型生成。',
    icon: <Video size={22} />,
    iconColor: '#c0841a',
    path: VIDEO_SITE_METADATA.seedance.entryPath,
    pointsPerUse: 0,
    isTrial: true,
    requiresAuth: true,
    videoSite: 'seedance',
  },
];

const BOT_ICON_MAP: Record<string, ReactNode> = {
  bot: <Bot size={22} />,
  target: <Target size={22} />,
  'list-checks': <Compass size={22} />,
  goal: <MapPin size={22} />,
  briefcase: <Briefcase size={22} />,
  users: <Users size={22} />,
  image: <Sparkles size={22} />,
  'trending-up': <TrendingUp size={22} />,
  zap: <Zap size={22} />,
  layout: <FrameIcon size={22} />,
  'git-branch': <GitBranch size={22} />,
  star: <Star size={22} />,
  swords: <Swords size={22} />,
  'dollar-sign': <Coins size={22} />,
  camera: <Camera size={22} />,
  link: <Link size={22} />,
  copy: <FileText size={22} />,
  type: <PenTool size={22} />,
  rocket: <Rocket size={22} />,
  clipboard: <ClipboardList size={22} />,
  'file-text': <Puzzle size={22} />,
  'message-circle': <MessageSquare size={22} />,
  flag: <Flag size={22} />,
  smartphone: <Smartphone size={22} />,
  'bar-chart': <BarChart3 size={22} />,
  calculator: <Calculator size={22} />,
  'git-merge': <GitBranch size={22} />,
  shield: <Shield size={22} />,
  wallet: <Wallet size={22} />,
  'alert-triangle': <AlertTriangle size={22} />,
  settings: <Settings size={22} />,
  search: <SearchIcon size={22} />,
  terminal: <FlaskConical size={22} />,
  'git-pull-request': <Brain size={22} />,
  sprout: <Sprout size={22} />,
};

const BOT_ICON_COLOR_MAP: Record<string, string> = {
  bot: '#0ea5e9',
  target: '#2563eb',
  'list-checks': '#7c3aed',
  goal: '#059669',
  briefcase: '#dc2626',
  users: '#ea580c',
  image: '#7c3aed',
  'trending-up': '#2563eb',
  zap: '#ea580c',
  layout: '#059669',
  'git-branch': '#dc2626',
  star: '#f59e0b',
  swords: '#7c3aed',
  'dollar-sign': '#059669',
  camera: '#dc2626',
  link: '#2563eb',
  copy: '#7c3aed',
  type: '#ea580c',
  rocket: '#059669',
  clipboard: '#f59e0b',
  'file-text': '#2563eb',
  'message-circle': '#dc2626',
  flag: '#dc2626',
  smartphone: '#1e293b',
  'bar-chart': '#2563eb',
  calculator: '#059669',
  'git-merge': '#7c3aed',
  shield: '#2563eb',
  wallet: '#ea580c',
  'alert-triangle': '#f59e0b',
  settings: '#64748b',
  search: '#2563eb',
  terminal: '#059669',
  'git-pull-request': '#7c3aed',
  sprout: '#16a34a',
};

const HOMEPAGE_BOTS: BotInfo[] = BUILTIN_BOTS
  .filter((bot) => bot.showOnHomepage !== false)
  .map((bot) => ({
  id: bot.routeId,
  name: bot.name,
  category: bot.category,
  icon: BOT_ICON_MAP[bot.icon] || <Bot size={22} />,
  iconColor: BOT_ICON_COLOR_MAP[bot.icon] || '#2563eb',
  description: bot.description,
  pointsPerUse: bot.pointsPerUse,
  isTrial: bot.homepageTrial ?? true,
  path: `/chat/${bot.routeId}`,
  requiresAuth: true,
}));

const ALL_HOMEPAGE_BOTS: BotInfo[] = [...HOMEPAGE_BOTS, IMAGE_TOOL, ...VIDEO_WORKBENCH_TOOLS];

const CATEGORY_ICONS: Record<string, ReactNode> = {
  '管理工具': <Compass size={18} />,
  '电商工具': <Package size={18} />,
  '小红书': <BookOpen size={18} />,
  '企业教练': <Landmark size={18} />,
  '财税': <Briefcase size={18} />,
  'AI陪跑教练': <Bot size={18} />,
  '绘图机器人': <Puzzle size={18} />,
  '视频工作台': <Video size={18} />,

};

export default function HomePage() {
  const { user, isAuthenticated, isLoading, loadUser } = useAuthStore();
  const { conversations, favorites, loadConversations, toggleFavorite, removeFavorite, deleteConversation } = useConversationsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [trialBotsOpen, setTrialBotsOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'history' | 'favorites'>('history');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [generalPrompt, setGeneralPrompt] = useState('');
  const [generalResponseModel, setGeneralResponseModel] = useState<ResponseModel>(DEFAULT_RESPONSE_MODEL);
  const [isGeneralRecording, setIsGeneralRecording] = useState(false);
  const [isGeneralTranscribing, setIsGeneralTranscribing] = useState(false);
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const generalRecorderRef = useRef<Pcm16Recorder | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => {
    if (!isAuthenticated) return;
    void loadConversations().catch((error) => {
      console.error('[Home] Failed to load conversations', error);
    });
  }, [isAuthenticated, loadConversations]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(`${RESPONSE_MODEL_STORAGE_PREFIX}${GENERIC_CHAT_BOT_ID}`);
    if (saved === 'gpt-5.4' || saved === 'gemini') {
      setGeneralResponseModel(saved);
      return;
    }
    setGeneralResponseModel(DEFAULT_RESPONSE_MODEL);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(`${RESPONSE_MODEL_STORAGE_PREFIX}${GENERIC_CHAT_BOT_ID}`, generalResponseModel);
  }, [generalResponseModel]);
  useEffect(() => () => {
    const recorder = generalRecorderRef.current;
    generalRecorderRef.current = null;
    if (!recorder) return;
    void recorder.stop().catch(() => undefined);
  }, []);

  const requireAuth = (path: string) => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    router.push(path);
  };

  const ensureAuthenticated = useCallback(() => {
    if (isAuthenticated) return true;
    router.push('/login');
    return false;
  }, [isAuthenticated, router]);

  const buildGenericChatUrl = useCallback((draft?: string) => {
    const query = new URLSearchParams();
    query.set('rm', generalResponseModel);
    if (draft?.trim()) {
      query.set('draft', draft.trim());
    }
    return `/chat/${GENERIC_CHAT_BOT_ID}?${query.toString()}`;
  }, [generalResponseModel]);

  const openGenericChat = useCallback((draft?: string) => {
    if (!ensureAuthenticated()) return;
    router.push(buildGenericChatUrl(draft));
  }, [buildGenericChatUrl, ensureAuthenticated, router]);

  const submitGenericChat = useCallback(() => {
    const text = generalPrompt.trim();
    if (!ensureAuthenticated()) return;
    setGeneralPrompt('');
    openGenericChat(text);
  }, [ensureAuthenticated, generalPrompt, openGenericChat]);

  const toggleGeneralVoice = useCallback(async () => {
    if (!ensureAuthenticated()) return;

    if (isGeneralRecording) {
      setIsGeneralRecording(false);
      const recorder = generalRecorderRef.current;
      generalRecorderRef.current = null;
      if (!recorder) return;

      try {
        const audioBlob = await recorder.stop();
        if (audioBlob.size < 1000) {
          throw new Error('录音时间太短，请重试');
        }

        setIsGeneralTranscribing(true);
        const formData = new FormData();
        formData.append('audio', audioBlob, 'homepage-recording.wav');

        const response = await fetch('/api/voice', { method: 'POST', body: formData });
        const data = await response.json();
        const transcript = typeof data.text === 'string' ? data.text.trim() : '';

        if (!transcript) {
          throw new Error(data.error || '语音识别失败');
        }

        router.push(buildGenericChatUrl(transcript));
      } catch (error) {
        alert(error instanceof Error ? error.message : '语音识别失败');
      } finally {
        setIsGeneralTranscribing(false);
      }
      return;
    }

    try {
      generalRecorderRef.current = await startPcm16kMonoRecorder();
      setIsGeneralRecording(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : '无法访问麦克风');
    }
  }, [buildGenericChatUrl, ensureAuthenticated, isGeneralRecording, router]);

  const launchWorkflow = (tpl: typeof WF_TEMPLATES[0]) => {
    if (!isAuthenticated) { router.push('/login'); return; }
    const state = {
      workflowId: tpl.id,
      workflowName: tpl.name,
      steps: tpl.steps.map(s => ({ botId: s.botId, botName: s.botName })),
      currentStep: 0,
      stepOutputs: [] as string[],
      selectedMessages: {} as Record<number, string[]>,
    };
    sessionStorage.setItem('wf_state', JSON.stringify(state));
    router.push(`/chat/${tpl.steps[0].botId}?wf=1`);
  };

  const categories = useMemo(
    () => Array.from(new Set([
      ...BUILTIN_CATEGORY_ORDER,
      IMAGE_TOOL.category,
      ...VIDEO_WORKBENCH_TOOLS.map((tool) => tool.category),
    ])),
    [],
  );
  const filteredBots = ALL_HOMEPAGE_BOTS.filter((bot) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return bot.name.toLowerCase().includes(q) || bot.description.toLowerCase().includes(q);
  });

  const buildBotGroups = (bots: BotInfo[]) => categories.map((cat) => ({
    category: cat,
    icon: CATEGORY_ICONS[cat] || <Brain size={18} />,
    bots: bots.filter((b) => b.category === cat),
  })).filter((g) => g.bots.length > 0);

  const formalBotGroups = buildBotGroups(filteredBots.filter((bot) => !bot.isTrial));
  const trialBotGroups = buildBotGroups(filteredBots.filter((bot) => bot.isTrial));
  const trialBotCount = trialBotGroups.reduce((count, group) => count + group.bots.length, 0);

  const sidebarConvs = (sidebarTab === 'favorites' ? favorites : conversations)
    .slice().sort((a, b) => b.updatedAt - a.updatedAt);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const getLastMsg = (conv: typeof conversations[0]) => {
    const last = conv.messages[conv.messages.length - 1];
    return last ? last.content.replace(/\[文件:.*?\]/g, '[文件]').slice(0, 40) : '';
  };

  const openBot = async (bot: BotInfo) => {
    if (bot.videoSite) {
      if (!isAuthenticated) { router.push('/login'); return; }
      try {
        const result = await api.startVideoSso({ site: bot.videoSite });
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } catch {
        router.push(bot.path);
      }
      return;
    }
    if (bot.requiresAuth) {
      requireAuth(bot.path);
      return;
    }
    router.push(bot.path);
  };

  const renderBotCard = (bot: BotInfo, badge?: ReactNode, extraClassName?: string) => (
    <div
      key={bot.id}
      className={[styles.botCard, extraClassName].filter(Boolean).join(' ')}
      onClick={() => openBot(bot)}
    >
      <div className={styles.botIcon} style={{ background: `${bot.iconColor}15`, color: bot.iconColor }}>{bot.icon}</div>
      <div className={styles.botInfo}>
        <div className={styles.botHeading}>
          <h4 className={styles.botName}>{bot.name}</h4>
          {badge ?? (bot.isTrial ? <span className={`${styles.botBadge} badge badge-orange`}>试用版</span> : null)}
        </div>
        <p className={styles.botDesc}>{bot.description}</p>
      </div>
    </div>
  );

  if (isLoading) return <div className={styles.loading}><div className={styles.spinner} /></div>;

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.sidebarToggle} onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={20} /></button>
          <span className={styles.logoIcon}><Bot size={22} /></span>
          <h1 className={styles.logo}>电商 AI 智能平台</h1>
        </div>
        <div className={styles.headerCenter}>
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}><Search size={16} /></span>
            <input
              type="text"
              placeholder="搜索工具或机器人..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
            <span className={styles.searchHint}>⌘K</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <button onClick={() => requireAuth('/my-bots')} className={styles.navBtn}>我的智能体</button>
          <button onClick={() => requireAuth('/my-workflows')} className={styles.navBtn}>我的工作流</button>
          {user?.role === 'admin' && (
            <button onClick={() => requireAuth('/admin/invite-codes')} className={styles.navBtn}>邀请码管理</button>
          )}
          <button onClick={() => requireAuth('/insights')} className={styles.navBtn}>网页洞察</button>
          {mounted && (
            <button
              className={styles.themeToggle}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          )}
          {isAuthenticated ? (
            <>
              <button onClick={() => router.push('/profile')} className={styles.avatarBtn}>{user?.nickname?.slice(0, 1) || '我'}</button>
            </>
          ) : (
            <button onClick={() => router.push('/login')} className={styles.navBtn}>登录</button>
          )}
        </div>
      </header>

      <div className={styles.body}>
        <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
          <div className={styles.sidebarTabs}>
            <button
              className={`${styles.sidebarTabBtn} ${sidebarTab === 'history' ? styles.sidebarTabActive : ''}`}
              onClick={() => setSidebarTab('history')}
              style={{ borderBottomColor: sidebarTab === 'history' ? '#2563eb' : 'transparent', color: sidebarTab === 'history' ? 'var(--text-primary, #0f172a)' : undefined }}
            >
              <MessageSquare size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> 聊天记录
            </button>
            <button
              className={`${styles.sidebarTabBtn} ${sidebarTab === 'favorites' ? styles.sidebarTabActive : ''}`}
              onClick={() => setSidebarTab('favorites')}
              style={{ borderBottomColor: sidebarTab === 'favorites' ? '#eab308' : 'transparent', color: sidebarTab === 'favorites' ? '#eab308' : undefined }}
            >
              <Star size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> 收藏
            </button>
          </div>
          <div className={styles.sidebarList}>
            {sidebarConvs.length === 0 ? (
              <div className={styles.sidebarEmpty}>{sidebarTab === 'favorites' ? '暂无收藏' : '暂无对话记录'}</div>
            ) : sidebarConvs.map((conv) => (
              <div key={conv.id} className={styles.sidebarItem} onClick={() => router.push(`/chat/${conv.botId}?cid=${conv.id}`)}>
                <div className={styles.sidebarItemTop}>
                  <span className={styles.sidebarBotName}>{conv.botName || '机器人'}</span>
                  <span className={styles.sidebarTime}>{formatTime(conv.updatedAt)}</span>
                </div>
                <p className={styles.sidebarPreview}>{getLastMsg(conv)}</p>
                <div className={styles.sidebarActions}>
                  {sidebarTab === 'history' && (
                    <button
                      className={styles.sidebarActionBtn}
                      style={{ color: conv.isFavorite ? '#eab308' : undefined }}
                      onClick={(e) => { e.stopPropagation(); void toggleFavorite(conv.id); }}
                    >
                      <Star size={14} fill={conv.isFavorite ? '#eab308' : 'none'} />
                    </button>
                  )}
                  <button className={styles.sidebarActionBtn} onClick={(e) => { e.stopPropagation(); if (sidebarTab === 'favorites') { void removeFavorite(conv.id); } else { void deleteConversation(conv.id); } }}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className={styles.main}>
          <div className={styles.workflowCards}>
            {WF_TEMPLATES.map((wf) => (
              <div key={wf.id} className={styles.wfCard} style={{ background: wf.gradient }} onClick={() => launchWorkflow(wf)}>
                <h3 className={styles.wfCardTitle}><Zap size={16} /> {wf.title}</h3>
                <div className={styles.wfSteps}>
                  {wf.displaySteps.map((s, i) => <span key={i}>{s}{i < wf.displaySteps.length - 1 && <span className={styles.wfArrow}> → </span>}</span>)}
                </div>
                <button className={styles.wfLaunchBtn}>立即启动</button>
              </div>
            ))}
            <div
              className={styles.wfCard}
              style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)' }}
              onClick={() => requireAuth('/my-workflows')}
            >
              <h3 className={styles.wfCardTitle}><Plus size={16} /> 自定义工作流</h3>
              <div className={styles.wfSteps}>
                <span>从空白画布创建专属工作流</span>
              </div>
              <button className={styles.wfLaunchBtn}>开始创建</button>
            </div>
          </div>

          <section className={styles.generalComposerSection}>
            <div className={styles.heroGreeting}>
              <h2 className={styles.heroGreetingTitle}>
                {isAuthenticated && user?.nickname
                  ? <><span className={styles.heroGreetingHighlight}>{user.nickname}，你好</span><br />需要我为你做些什么？</>
                  : <><span className={styles.heroGreetingHighlight}>你好</span><br />需要我为你做些什么？</>}
              </h2>
            </div>

            <div className={styles.generalComposerCard}>
              <textarea
                value={generalPrompt}
                onChange={(event) => setGeneralPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (generalPrompt.trim()) {
                      submitGenericChat();
                    }
                  }
                }}
                className={styles.generalComposerInput}
                placeholder={isGeneralTranscribing
                  ? '语音转录中，请稍候...'
                  : '在这里输入任何问题...'}
                rows={2}
              />

              <div className={styles.generalComposerFooter}>
                <div className={styles.generalComposerControls}>
                  <div className={styles.generalComposerModelSwitcher}>
                    <select
                      aria-label="通用聊天回答模型"
                      className={styles.generalComposerModelSelect}
                      value={generalResponseModel}
                      onChange={(event) => setGeneralResponseModel(event.target.value as ResponseModel)}
                      disabled={isGeneralRecording || isGeneralTranscribing}
                    >
                      {RESPONSE_MODEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} className={styles.generalComposerModelChevron} />
                  </div>

                  <button
                    type="button"
                    className={`${styles.generalComposerVoiceBtn} ${isGeneralRecording ? styles.generalComposerVoiceBtnActive : ''}`}
                    onClick={() => void toggleGeneralVoice()}
                    disabled={isGeneralTranscribing}
                    title={isGeneralTranscribing ? '语音转录中...' : isGeneralRecording ? '停止录音' : '语音输入'}
                  >
                    {isGeneralTranscribing ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
                  </button>

                  <button
                    type="button"
                    className={styles.generalComposerSendBtn}
                    onClick={() => {
                      if (generalPrompt.trim()) {
                        submitGenericChat();
                        return;
                      }
                      openGenericChat();
                    }}
                    disabled={isGeneralRecording || isGeneralTranscribing}
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {formalBotGroups.map((group) => (
            <div key={group.category} className={styles.categorySection}>
              <h3 className={styles.categoryTitle}>{group.icon} {group.category}</h3>
              <div className={styles.botGrid}>
                {group.bots.map((bot) => renderBotCard(
                  bot,
                  <span className={`${styles.botBadge} badge badge-green`}>正式版</span>,
                  bot.id === QIYA_ENTERPRISE_MANAGEMENT_BOT_ID ? styles.enterpriseBotCard : undefined,
                ))}
              </div>
            </div>
          ))}

          {trialBotGroups.length > 0 && (
            <div className={styles.categorySection}>
              <button
                type="button"
                className={styles.trialToggle}
                onClick={() => setTrialBotsOpen((open) => !open)}
                aria-expanded={trialBotsOpen}
              >
                <span className={styles.trialToggleText}>
                  <span className={styles.trialToggleLabel}>
                    {trialBotsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    试用版机器人
                  </span>
                  <span className={styles.trialToggleHint}>
                    展开后按类型查看全部试用版机器人
                  </span>
                </span>
                <span className={styles.trialToggleMeta}>
                  {trialBotsOpen ? '收起分类' : `${trialBotCount} 个机器人`}
                </span>
              </button>

              {trialBotsOpen ? (
                <div className={styles.trialPanel}>
                  {trialBotGroups.map((group) => (
                    <div key={group.category} className={styles.trialCategorySection}>
                      <h4 className={styles.trialCategoryTitle}>{group.icon} {group.category}</h4>
                      <div className={styles.botGrid}>
                        {group.bots.map((bot) => renderBotCard(bot))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {filteredBots.length === 0 && (
            <div className={styles.empty}><p>没有找到匹配的机器人</p></div>
          )}
        </main>
      </div>

      <div className={styles.mobileNav}>
        <button className={styles.mobileNavBtn} onClick={() => router.push('/')}><span><Home size={20} /></span>首页</button>
        <button className={styles.mobileNavBtn} onClick={() => requireAuth('/my-workflows')}><span><Zap size={20} /></span>工作流</button>
        <button className={styles.mobileNavBtn} onClick={() => router.push('/bot/image-generator')}><span><ImageIcon size={20} /></span>绘图</button>
        <button className={styles.mobileNavBtn} onClick={() => requireAuth('/profile')}><span><User size={20} /></span>我的</button>
      </div>
    </div>
  );
}
