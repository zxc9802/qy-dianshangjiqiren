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
  DEFAULT_WEB_SEARCH_MODE,
  RESPONSE_MODEL_OPTIONS,
  RESPONSE_MODEL_STORAGE_PREFIX,
  WEB_SEARCH_MODE_OPTIONS,
  WEB_SEARCH_MODE_STORAGE_PREFIX,
  isResponseModel,
  isWebSearchMode,
  type ResponseModel,
  type WebSearchMode,
} from './lib/chat-models';
import { putLaunchChatDraft } from './lib/launch-chat-drafts';
import { VIDEO_SITE_METADATA, type VideoSiteKey } from './lib/video-sites';
import { XHS_SITE_METADATA } from './lib/xhs-site';
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
  Mic, Paperclip, Send, Loader2, Video, X,
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
    name: '鏂板搧涓婃灦鍏ㄦ祦绋?,
    title: '鐖嗘鎵撻€犳祦姘寸嚎',
    steps: [
      { botId: '9', botName: '鍗栫偣鏁欑粌', instruction: '璇峰府鎴戞彁鐐艰繖涓骇鍝佺殑鏍稿績鍗栫偣' },
      { botId: '10', botName: '澶╃尗涓诲浘绛栧垝鏁欑粌', instruction: '鍩轰簬鍗栫偣锛屽府鎴戠瓥鍒?寮犲ぉ鐚富鍥炬柟妗? },
      { botId: '12', botName: '澶╃尗璇勪环鏁欑粌', instruction: '鍩轰簬浜у搧鍗栫偣鍜屼富鍥撅紝璁捐鐪熷疄鑷劧鐨勮瘎浠锋ā鏉? },
    ],
    displaySteps: ['鍗栫偣', '涓诲浘', '璇勪环'],
    gradient: 'linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)',
  },
  {
    id: 'wf-3',
    name: '灏忕孩涔﹀唴瀹圭煩闃?,
    title: '灏忕孩涔﹀唴瀹圭煩闃?,
    steps: [
      { botId: '17', botName: '灏忕孩涔︾垎鏂囨媶瑙ｅ鍒?, instruction: '鎷嗚В杩欎釜鏂瑰悜鐨勭垎鏂囧叕寮忥紝鎻愮偧鍙鐢ㄥ厓绱? },
      { botId: '18', botName: '灏忕孩涔︾垎娆炬爣棰?, instruction: '鍩轰簬鐖嗘枃鍒嗘瀽锛岀粰鍑?0涓珮鐐瑰嚮鐜囨爣棰? },
      { botId: '21', botName: '灏忕孩涔︽鏂囨媶瑙OP', instruction: '鍩轰簬浠ヤ笂鏍囬锛屾寜鐖嗘枃鍏紡鍐欏畬鏁存鏂? },
      { botId: '22', botName: '灏忕孩涔︾瑪璁拌瘎璁虹敓鎴?, instruction: '鍩轰簬鍐呭锛岀敓鎴?0鏉¤嚜鐒跺紩瀵间簰鍔ㄧ殑璇勮' },
    ],
    displaySteps: ['鐖嗘枃', '鏍囬', '姝ｆ枃', '璇勮'],
    gradient: 'linear-gradient(135deg, #16a34a 0%, #4ade80 100%)',
  },
  {
    id: 'wf-2',
    name: '绔炲搧鍏ㄩ潰鍒嗘瀽',
    title: '绔炲搧鍏ㄩ潰鍒嗘瀽',
    steps: [
      { botId: '13', botName: '澶╃尗绔炰簤绛栫暐鏁欑粌', instruction: '鍒嗘瀽浠ヤ笅浜у搧/绫荤洰鐨勭珵鍝佷紭鍔ｅ娍' },
      { botId: '8', botName: '澶╃尗鐖嗘瓒嬪娍鎷嗚В', instruction: '鍩轰簬绔炲搧鍒嗘瀽锛屾繁鍏ュ垎鏋愯鍝佺被瓒嬪娍鍜屾満浼? },
      { botId: '14', botName: '澶╃尗瀹㈠崟浠锋彁鍗囨暀缁?, instruction: '鍩轰簬绔炲搧鍜岃秼鍔垮垎鏋愶紝鍒跺畾瀹氫环鍜屽鍗曚环鎻愬崌绛栫暐' },
    ],
    displaySteps: ['绔炲搧', '瓒嬪娍', '瀹氫环'],
    gradient: 'linear-gradient(135deg, #ea580c 0%, #fb923c 100%)',
  },
];

const IMAGE_TOOL: BotInfo = {
  id: 'image-generator',
  name: '鐢靛晢鍥剧墖鐢熸垚鏈哄櫒浜?,
  category: '缁樺浘鏈哄櫒浜?,
  description: '涓婁紶鍙傝€冨浘锛屾寜鍙傛暟涓€閿敓鎴?2K 鐢靛晢鍥撅紝鏀寔鍘嗗彶澶嶇敤涓庝簩娆＄紪杈戙€?,
  icon: <ImageIcon size={22} />,
  iconColor: '#7c3aed',
  path: '/bot/image-generator',
  pointsPerUse: 0,
  isTrial: true,
  requiresAuth: false,
};

const DETAIL_IMAGE_AGENT_TOOL: BotInfo = {
  id: 'detail-image-agent',
  name: '搴楅摵鍥剧墖宸ュ叿',
  category: '缁樺浘鏈哄櫒浜?,
  description: '鐧诲綍鍚庣洿杈惧簵閾哄浘鐗囧伐鍏凤紝鏀寔鎸夎处鍙蜂繚瀛樺巻鍙茶褰曚笌澶嶇敤鐢熸垚缁撴灉銆?,
  icon: <ImageIcon size={22} />,
  iconColor: '#0891b2',
  path: '/bot/detail-image-agent?autostart=1&openMode=replace',
  pointsPerUse: 0,
  isTrial: false,
  requiresAuth: true,
};

const BUYER_SHOW_TOOL: BotInfo = {
  id: 'buyer-show',
  name: '涔板绉€鏅鸿兘浣?,
  category: '缁樺浘鏈哄櫒浜?,
  description: '鐧诲綍鍚庣洿杈句拱瀹剁鏅鸿兘浣擄紝鎸変富绔欒处鍙蜂繚瀛樼敓鎴愬巻鍙蹭笌璇勮鑽夌銆?,
  icon: <ImageIcon size={22} />,
  iconColor: '#0f766e',
  path: '/bot/buyer-show?autostart=1&openMode=replace',
  pointsPerUse: 0,
  isTrial: false,
  requiresAuth: true,
};

const KB_CHAT_TOOL: BotInfo = {
  id: 'kb-chat',
  name: '璧疯娊鐭ヨ瘑搴撴満鍣ㄤ汉',
  category: '绠＄悊宸ュ叿',
  description: '鐧诲綍涓荤珯鍚庣洿杈句紒涓氱煡璇嗗簱闂瓟鏈哄櫒浜猴紝鏀寔鍐呴儴鐭ヨ瘑銆佷笂浼犺祫鏂欎笌鎶ュ憡鐢熸垚銆?,
  icon: <BookOpen size={22} />,
  iconColor: '#0f766e',
  path: '/bot/kb-chat?autostart=1&openMode=replace',
  pointsPerUse: 0,
  isTrial: false,
  requiresAuth: true,
};

const COPYWRITING_AGENT_TOOL: BotInfo = {
  id: 'copywriting-agent',
  name: '鑰侀粍 AI 鏂囨鎬绘帶',
  category: '鐢靛晢宸ュ叿',
  description: '鐧诲綍鍚庣洿杈炬枃妗堟€绘帶鏅鸿兘浣擄紝鎸変富绔欒处鍙烽殧绂绘渚嬪簱銆佺礌鏉愬簱涓庡唴瀹硅〃鐜版暟鎹€?,
  icon: <PenTool size={22} />,
  iconColor: '#dc2626',
  path: '/bot/copywriting-agent?autostart=1&openMode=replace',
  pointsPerUse: 0,
  isTrial: false,
  requiresAuth: true,
};

const XHS_AUTO_PUBLISH_TOOL: BotInfo = {
  id: 'xhs-auto-publish',
  name: 'XHS auto publisher',
  category: '绠＄悊宸ュ叿',
  description: 'Open the XHS auto publishing console with your main-site account and synced permissions.',
  icon: <Smartphone size={22} />,
  iconColor: '#dc0033',
  path: `${XHS_SITE_METADATA.entryPath}?autostart=1&openMode=replace`,
  pointsPerUse: 0,
  isTrial: false,
  requiresAuth: true,
};

const VIDEO_WORKBENCH_TOOLS: BotInfo[] = [
  {
    id: 'video-workbench',
    name: '瑙嗛宸ヤ綔鍙?,
    category: '瑙嗛宸ヤ綔鍙?,
    description: '鐧诲綍鍚庤繘鍏ヨ棰戝伐浣滃彴锛屼綋楠岃棰戠敓鎴愬弬鏁伴潰鏉裤€侀瑙堝尯鍜屽伐浣滃彴寮忔搷浣滅晫闈€?,
    icon: <Video size={22} />,
    iconColor: '#c0841a',
    path: VIDEO_SITE_METADATA.seedance.entryPath,
    pointsPerUse: 0,
    isTrial: true,
    requiresAuth: true,
    videoSite: 'seedance',
  },
  {
    id: 'tiktok-studio',
    name: 'TikTok Studio',
    category: '瑙嗛宸ヤ綔鍙?,
    description: '鐧诲綍鍚庤繘鍏?TikTok Studio锛屼綋楠?TikTok 涓撶敤鐨勮棰戠敓鎴愪笌宸ヤ綔鍙板紡鎿嶄綔鍏ュ彛銆?,
    icon: <Video size={22} />,
    iconColor: '#0284c7',
    path: VIDEO_SITE_METADATA.tiktok.entryPath,
    pointsPerUse: 0,
    isTrial: true,
    requiresAuth: true,
    videoSite: 'tiktok',
  },
];

const HOMEPAGE_MAX_ATTACHMENTS = 10;
const HOMEPAGE_ATTACHMENT_ACCEPT = '.pdf,.docx,.txt,.md,.csv,.pptx,.jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.webm,.m4v';

function getHomepageAttachmentKind(file: File): 'document' | 'image' | 'video' {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
    return 'image';
  }
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) {
    return 'video';
  }
  return 'document';
}

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

const ALL_HOMEPAGE_BOTS: BotInfo[] = [
  KB_CHAT_TOOL,
  XHS_AUTO_PUBLISH_TOOL,
  COPYWRITING_AGENT_TOOL,
  ...HOMEPAGE_BOTS,
  BUYER_SHOW_TOOL,
  DETAIL_IMAGE_AGENT_TOOL,
  IMAGE_TOOL,
  ...VIDEO_WORKBENCH_TOOLS,
];

const CATEGORY_ICONS: Record<string, ReactNode> = {
  '绠＄悊宸ュ叿': <Compass size={18} />,
  '鐢靛晢宸ュ叿': <Package size={18} />,
  '灏忕孩涔?: <BookOpen size={18} />,
  '浼佷笟鏁欑粌': <Landmark size={18} />,
  '璐㈢◣': <Briefcase size={18} />,
  'AI闄窇鏁欑粌': <Bot size={18} />,
  '缁樺浘鏈哄櫒浜?: <Puzzle size={18} />,
  '瑙嗛宸ヤ綔鍙?: <Video size={18} />,

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
  const [generalAttachedFiles, setGeneralAttachedFiles] = useState<File[]>([]);
  const [generalResponseModel, setGeneralResponseModel] = useState<ResponseModel>(DEFAULT_RESPONSE_MODEL);
  const [generalWebSearchMode, setGeneralWebSearchMode] = useState<WebSearchMode>(DEFAULT_WEB_SEARCH_MODE);
  const [isGeneralRecording, setIsGeneralRecording] = useState(false);
  const [isGeneralTranscribing, setIsGeneralTranscribing] = useState(false);
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const generalRecorderRef = useRef<Pcm16Recorder | null>(null);
  const generalFileInputRef = useRef<HTMLInputElement | null>(null);

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
    if (isResponseModel(saved)) {
      setGeneralResponseModel(saved);
      return;
    }
    setGeneralResponseModel(DEFAULT_RESPONSE_MODEL);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(`${RESPONSE_MODEL_STORAGE_PREFIX}${GENERIC_CHAT_BOT_ID}`, generalResponseModel);
  }, [generalResponseModel]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(`${WEB_SEARCH_MODE_STORAGE_PREFIX}${GENERIC_CHAT_BOT_ID}`);
    if (isWebSearchMode(saved)) {
      setGeneralWebSearchMode(saved);
      return;
    }
    setGeneralWebSearchMode(DEFAULT_WEB_SEARCH_MODE);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(`${WEB_SEARCH_MODE_STORAGE_PREFIX}${GENERIC_CHAT_BOT_ID}`, generalWebSearchMode);
  }, [generalWebSearchMode]);
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

  const buildGenericChatUrl = useCallback((draft?: string, launchDraftId?: string | null) => {
    const query = new URLSearchParams();
    query.set('rm', generalResponseModel);
    query.set('ws', generalWebSearchMode);
    if (draft?.trim()) {
      query.set('draft', draft.trim());
    }
    if (launchDraftId) {
      query.set('ld', launchDraftId);
    }
    return `/chat/${GENERIC_CHAT_BOT_ID}?${query.toString()}`;
  }, [generalResponseModel, generalWebSearchMode]);

  const openGenericChat = useCallback(async (draft?: string) => {
    if (!ensureAuthenticated()) return;
    let launchDraftId: string | null = null;

    if (generalAttachedFiles.length > 0) {
      try {
        const draftRecord = await putLaunchChatDraft({
          prompt: draft?.trim() || '',
          files: generalAttachedFiles,
        });
        launchDraftId = draftRecord.id;
      } catch (error) {
        alert(error instanceof Error ? error.message : '闄勪欢鏆傚瓨澶辫触锛岃閲嶈瘯');
        return;
      }
    }

    setGeneralPrompt('');
    setGeneralAttachedFiles([]);
    router.push(buildGenericChatUrl(draft, launchDraftId));
  }, [buildGenericChatUrl, ensureAuthenticated, generalAttachedFiles, router]);

  const submitGenericChat = useCallback(async () => {
    const text = generalPrompt.trim();
    if (!ensureAuthenticated()) return;
    if (!text && generalAttachedFiles.length === 0) {
      return;
    }
    await openGenericChat(text);
  }, [ensureAuthenticated, generalAttachedFiles.length, generalPrompt, openGenericChat]);

  const handleGeneralFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    event.target.value = '';

    try {
      if (generalAttachedFiles.length >= HOMEPAGE_MAX_ATTACHMENTS) {
        throw new Error(`涓€娆℃渶澶氫笂浼?${HOMEPAGE_MAX_ATTACHMENTS} 涓枃浠禶);
      }

      const availableSlots = HOMEPAGE_MAX_ATTACHMENTS - generalAttachedFiles.length;
      const nextFiles = files.slice(0, availableSlots);
      setGeneralAttachedFiles((current) => [...current, ...nextFiles]);

      if (files.length > availableSlots) {
        alert(`涓€娆℃渶澶氫笂浼?${HOMEPAGE_MAX_ATTACHMENTS} 涓枃浠讹紝鍏朵綑鏂囦欢宸插拷鐣);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '鏂囦欢涓婁紶澶辫触');
    }
  }, [generalAttachedFiles.length]);

  const removeGeneralAttachment = useCallback((index: number) => {
    setGeneralAttachedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  }, []);

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
          throw new Error('褰曢煶鏃堕棿澶煭锛岃閲嶈瘯');
        }

        setIsGeneralTranscribing(true);
        const formData = new FormData();
        formData.append('audio', audioBlob, 'homepage-recording.wav');

        const response = await fetch('/api/voice', { method: 'POST', body: formData });
        const data = await response.json();
        const transcript = typeof data.text === 'string' ? data.text.trim() : '';

        if (!transcript) {
          throw new Error(data.error || '璇煶璇嗗埆澶辫触');
        }

        await openGenericChat(transcript);
      } catch (error) {
        alert(error instanceof Error ? error.message : '璇煶璇嗗埆澶辫触');
      } finally {
        setIsGeneralTranscribing(false);
      }
      return;
    }

    try {
      generalRecorderRef.current = await startPcm16kMonoRecorder();
      setIsGeneralRecording(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : '鏃犳硶璁块棶楹﹀厠椋?);
    }
  }, [ensureAuthenticated, isGeneralRecording, openGenericChat]);

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
    return last ? last.content.replace(/\[鏂囦欢:.*?\]/g, '[鏂囦欢]').slice(0, 40) : '';
  };

  const openBot = async (bot: BotInfo) => {
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
          {badge ?? (bot.isTrial ? <span className={`${styles.botBadge} badge badge-orange`}>璇曠敤鐗?/span> : null)}
        </div>
        <p className={styles.botDesc}>{bot.description}</p>
      </div>
    </div>
  );

  const canSubmitGeneralChat = generalPrompt.trim().length > 0 || generalAttachedFiles.length > 0;

  if (isLoading) return <div className={styles.loading}><div className={styles.spinner} /></div>;

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.sidebarToggle} onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={20} /></button>
          <span className={styles.logoIcon}><Bot size={22} /></span>
          <h1 className={styles.logo}>鐢靛晢 AI 鏅鸿兘骞冲彴</h1>
        </div>
        <div className={styles.headerCenter}>
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}><Search size={16} /></span>
            <input
              type="text"
              placeholder="鎼滅储宸ュ叿鎴栨満鍣ㄤ汉..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
            <span className={styles.searchHint}>鈱楰</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <button onClick={() => requireAuth('/my-bots')} className={styles.navBtn}>鎴戠殑鏅鸿兘浣?/button>
          <button onClick={() => requireAuth('/my-workflows')} className={styles.navBtn}>鎴戠殑宸ヤ綔娴?/button>
          {user?.role === 'admin' && (
            <button onClick={() => requireAuth('/admin/invite-codes')} className={styles.navBtn}>閭€璇风爜绠＄悊</button>
          )}
          <button onClick={() => requireAuth('/insights')} className={styles.navBtn}>缃戦〉娲炲療</button>
          {mounted && (
            <button
              className={styles.themeToggle}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? '鍒囨崲浜壊妯″紡' : '鍒囨崲鏆楄壊妯″紡'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          )}
          {isAuthenticated ? (
            <>
              <button onClick={() => router.push('/profile')} className={styles.avatarBtn}>{user?.nickname?.slice(0, 1) || '鎴?}</button>
            </>
          ) : (
            <button onClick={() => router.push('/login')} className={styles.navBtn}>鐧诲綍</button>
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
              <MessageSquare size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> 鑱婂ぉ璁板綍
            </button>
            <button
              className={`${styles.sidebarTabBtn} ${sidebarTab === 'favorites' ? styles.sidebarTabActive : ''}`}
              onClick={() => setSidebarTab('favorites')}
              style={{ borderBottomColor: sidebarTab === 'favorites' ? '#eab308' : 'transparent', color: sidebarTab === 'favorites' ? '#eab308' : undefined }}
            >
              <Star size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> 鏀惰棌
            </button>
          </div>
          <div className={styles.sidebarList}>
            {sidebarConvs.length === 0 ? (
              <div className={styles.sidebarEmpty}>{sidebarTab === 'favorites' ? '鏆傛棤鏀惰棌' : '鏆傛棤瀵硅瘽璁板綍'}</div>
            ) : sidebarConvs.map((conv) => (
              <div key={conv.id} className={styles.sidebarItem} onClick={() => router.push(`/chat/${conv.botId}?cid=${conv.id}`)}>
                <div className={styles.sidebarItemTop}>
                  <span className={styles.sidebarBotName}>{conv.botName || '鏈哄櫒浜?}</span>
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
                  {wf.displaySteps.map((s, i) => <span key={i}>{s}{i < wf.displaySteps.length - 1 && <span className={styles.wfArrow}> 鈫?</span>}</span>)}
                </div>
                <button className={styles.wfLaunchBtn}>绔嬪嵆鍚姩</button>
              </div>
            ))}
            <div
              className={styles.wfCard}
              style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)' }}
              onClick={() => requireAuth('/my-workflows')}
            >
              <h3 className={styles.wfCardTitle}><Plus size={16} /> 鑷畾涔夊伐浣滄祦</h3>
              <div className={styles.wfSteps}>
                <span>浠庣┖鐧界敾甯冨垱寤轰笓灞炲伐浣滄祦</span>
              </div>
              <button className={styles.wfLaunchBtn}>寮€濮嬪垱寤?/button>
            </div>
          </div>

          <section className={styles.generalComposerSection}>
            <div className={styles.heroGreeting}>
              <h2 className={styles.heroGreetingTitle}>
                {isAuthenticated && user?.nickname
                  ? <><span className={styles.heroGreetingHighlight}>{user.nickname}锛屼綘濂?/span><br />闇€瑕佹垜涓轰綘鍋氫簺浠€涔堬紵</>
                  : <><span className={styles.heroGreetingHighlight}>浣犲ソ</span><br />闇€瑕佹垜涓轰綘鍋氫簺浠€涔堬紵</>}
              </h2>
            </div>

            <div className={styles.generalComposerCard}>
              <input
                ref={generalFileInputRef}
                type="file"
                multiple
                accept={HOMEPAGE_ATTACHMENT_ACCEPT}
                onChange={handleGeneralFileUpload}
                style={{ display: 'none' }}
              />
              <textarea
                value={generalPrompt}
                onChange={(event) => setGeneralPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (canSubmitGeneralChat) {
                      void submitGenericChat();
                    }
                  }
                }}
                className={styles.generalComposerInput}
                placeholder={isGeneralTranscribing
                  ? '璇煶杞綍涓紝璇风◢鍊?..'
                  : '鍦ㄨ繖閲岃緭鍏ヤ换浣曢棶棰?..'}
                rows={2}
              />

              {generalAttachedFiles.length > 0 && (
                <div className={styles.generalComposerAttachmentList}>
                  {generalAttachedFiles.map((file, index) => {
                    const kind = getHomepageAttachmentKind(file);
                    const icon = kind === 'image'
                      ? <ImageIcon size={14} />
                      : kind === 'video'
                        ? <Video size={14} />
                        : <FileText size={14} />;

                    return (
                      <div key={`${file.name}-${file.size}-${index}`} className={styles.generalComposerAttachmentChip}>
                        <span className={styles.generalComposerAttachmentIcon}>{icon}</span>
                        <span className={styles.generalComposerAttachmentName}>{file.name}</span>
                        <button
                          type="button"
                          className={styles.generalComposerAttachmentRemove}
                          onClick={() => removeGeneralAttachment(index)}
                          aria-label={`绉婚櫎 ${file.name}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className={styles.generalComposerFooter}>
                <div className={styles.generalComposerFooterStart}>
                  <button
                    type="button"
                    className={styles.generalComposerUploadBtn}
                    onClick={() => generalFileInputRef.current?.click()}
                    disabled={isGeneralRecording || isGeneralTranscribing}
                  >
                    <Paperclip size={16} />
                    {generalAttachedFiles.length > 0
                      ? `宸查€?${generalAttachedFiles.length} 涓檮浠禶
                      : '涓婁紶闄勪欢'}
                  </button>
                </div>
                <div className={styles.generalComposerControls}>
                  <div className={styles.generalComposerModelSwitcher}>
                    <select
                      aria-label="閫氱敤鑱婂ぉ鍥炵瓟妯″瀷"
                      className={styles.generalComposerModelSelect}
                      value={generalResponseModel}
                      onChange={(event) => {
                        if (isResponseModel(event.target.value)) {
                          setGeneralResponseModel(event.target.value);
                        }
                      }}
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
                  <div className={styles.generalComposerModelSwitcher}>
                    <select
                      aria-label="鑱旂綉鎼滅储妯″紡"
                      className={styles.generalComposerModelSelect}
                      value={generalWebSearchMode}
                      onChange={(event) => {
                        if (isWebSearchMode(event.target.value)) {
                          setGeneralWebSearchMode(event.target.value);
                        }
                      }}
                      disabled={isGeneralRecording || isGeneralTranscribing}
                    >
                      {WEB_SEARCH_MODE_OPTIONS.map((option) => (
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
                    title={isGeneralTranscribing ? '璇煶杞綍涓?..' : isGeneralRecording ? '鍋滄褰曢煶' : '璇煶杈撳叆'}
                  >
                    {isGeneralTranscribing ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
                  </button>

                  <button
                    type="button"
                    className={styles.generalComposerSendBtn}
                    onClick={() => {
                      if (canSubmitGeneralChat) {
                        void submitGenericChat();
                        return;
                      }
                      void openGenericChat();
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
                  <span className={`${styles.botBadge} badge badge-green`}>姝ｅ紡鐗?/span>,
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
                    璇曠敤鐗堟満鍣ㄤ汉
                  </span>
                  <span className={styles.trialToggleHint}>
                    灞曞紑鍚庢寜绫诲瀷鏌ョ湅鍏ㄩ儴璇曠敤鐗堟満鍣ㄤ汉
                  </span>
                </span>
                <span className={styles.trialToggleMeta}>
                  {trialBotsOpen ? '鏀惰捣鍒嗙被' : `${trialBotCount} 涓満鍣ㄤ汉`}
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
            <div className={styles.empty}><p>娌℃湁鎵惧埌鍖归厤鐨勬満鍣ㄤ汉</p></div>
          )}
        </main>
      </div>

      <div className={styles.mobileNav}>
        <button className={styles.mobileNavBtn} onClick={() => router.push('/')}><span><Home size={20} /></span>棣栭〉</button>
        <button className={styles.mobileNavBtn} onClick={() => requireAuth('/my-workflows')}><span><Zap size={20} /></span>宸ヤ綔娴?/button>
        <button className={styles.mobileNavBtn} onClick={() => router.push('/bot/image-generator')}><span><ImageIcon size={20} /></span>缁樺浘</button>
        <button className={styles.mobileNavBtn} onClick={() => requireAuth('/profile')}><span><User size={20} /></span>鎴戠殑</button>
      </div>
    </div>
  );
}
