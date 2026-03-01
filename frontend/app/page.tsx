'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useAuthStore } from './stores/auth';
import { useConversationsStore } from './stores/conversations';
import styles from './page.module.css';

interface BotInfo {
  id: string;
  name: string;
  category: string;
  icon: string;
  iconColor: string;
  description: string;
  pointsPerUse: number;
}

const WORKFLOW_CARDS = [
  { id: 'wf-1', title: '爆款打造流水线', steps: ['趋势', '卖点', '主图', '评价'], gradient: 'linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)' },
  { id: 'wf-2', title: '小红书内容矩阵', steps: ['选题', '脚本', '拍摄', '发布'], gradient: 'linear-gradient(135deg, #16a34a 0%, #4ade80 100%)' },
  { id: 'wf-3', title: '新品上市全案', steps: ['预热', '首发', '种草', '转化'], gradient: 'linear-gradient(135deg, #ea580c 0%, #fb923c 100%)' },
];

const IMAGE_TOOL = {
  name: '电商图片生成机器人',
  category: '绘图机器人',
  description: '上传参考图，按参数一键生成 2K 电商图，支持历史复用与二次编辑。',
  icon: '🖼️',
  iconColor: '#7c3aed',
  route: '/bot/image-generator',
};

const MOCK_BOTS: BotInfo[] = [
  { id: '1', name: 'KPI教练', category: '管理工具', icon: '🎯', iconColor: '#2563eb', description: '设计可量化 KPI 体系，让团队目标清晰可追踪。', pointsPerUse: 5 },
  { id: '2', name: 'SOP梳理AI教练', category: '管理工具', icon: '🧭', iconColor: '#7c3aed', description: '把经验沉淀成标准流程，提升组织复制效率。', pointsPerUse: 5 },
  { id: '3', name: 'OKR教练', category: '管理工具', icon: '📍', iconColor: '#059669', description: '聚焦战略目标，建立上下对齐的目标管理机制。', pointsPerUse: 5 },
  { id: '4', name: '电商商业顾问', category: '管理工具', icon: '💼', iconColor: '#dc2626', description: '多维度分析业务问题，给出可执行的增长建议。', pointsPerUse: 8 },
  { id: '5', name: '招聘教练', category: '管理工具', icon: '👥', iconColor: '#ea580c', description: '从岗位画像到面试评估，优化招聘全流程。', pointsPerUse: 5 },
  { id: '6', name: 'AI通用助手', category: '管理工具', icon: '🤖', iconColor: '#0ea5e9', description: '写作、改写、分析、总结等通用任务处理。', pointsPerUse: 3 },

  { id: '7', name: '一键出10图提示词', category: '电商工具', icon: '✨', iconColor: '#7c3aed', description: '快速生成多套电商出图提示词，覆盖不同场景。', pointsPerUse: 8 },
  { id: '8', name: '天猫爆款趋势拆解', category: '电商工具', icon: '📈', iconColor: '#2563eb', description: '拆解类目趋势逻辑，发现潜在爆款机会。', pointsPerUse: 8 },
  { id: '9', name: '卖点教练', category: '电商工具', icon: '⚡', iconColor: '#ea580c', description: '提炼核心卖点，形成更强购买转化表达。', pointsPerUse: 5 },
  { id: '10', name: '天猫主图策划教练', category: '电商工具', icon: '🖼️', iconColor: '#059669', description: '输出主图结构、视觉层级与点击优化策略。', pointsPerUse: 5 },
  { id: '11', name: '爆款裂变分析AI教练', category: '电商工具', icon: '🔀', iconColor: '#dc2626', description: '拆解爆款可复制元素，扩展到更多人群与场景。', pointsPerUse: 8 },
  { id: '12', name: '天猫评价教练', category: '电商工具', icon: '⭐', iconColor: '#f59e0b', description: '优化评价内容结构，提升信任与转化。', pointsPerUse: 5 },
  { id: '13', name: '天猫竞争策略教练', category: '电商工具', icon: '⚔️', iconColor: '#7c3aed', description: '分析竞品优劣势，制定差异化竞争方案。', pointsPerUse: 8 },
  { id: '14', name: '天猫客单价提升教练', category: '电商工具', icon: '💰', iconColor: '#059669', description: '通过组合策略与定价设计提高客单价。', pointsPerUse: 5 },

  { id: '15', name: '小红书爆文封面拆解', category: '小红书', icon: '📷', iconColor: '#dc2626', description: '拆解封面构图、配色与文案排版，提炼爆点模板。', pointsPerUse: 5 },
  { id: '16', name: '小红书私域搭建SOP', category: '小红书', icon: '🔗', iconColor: '#2563eb', description: '设计合规引流路径，打通公域到私域转化。', pointsPerUse: 8 },
  { id: '17', name: '小红书爆文拆解复制', category: '小红书', icon: '📑', iconColor: '#7c3aed', description: '逆向拆解爆文，沉淀可复用创作方法。', pointsPerUse: 5 },
  { id: '18', name: '小红书爆款标题', category: '小红书', icon: '✍️', iconColor: '#ea580c', description: '生成多套高点击标题并给出使用建议。', pointsPerUse: 3 },
  { id: '19', name: '小红书起号话题', category: '小红书', icon: '🚀', iconColor: '#059669', description: '为新账号制定起号阶段话题与内容方向。', pointsPerUse: 5 },
  { id: '20', name: '小红书达人SOP流程', category: '小红书', icon: '📋', iconColor: '#f59e0b', description: '规范达人合作流程，从筛选到复盘闭环。', pointsPerUse: 8 },
  { id: '21', name: '小红书正文拆解SOP', category: '小红书', icon: '🧩', iconColor: '#2563eb', description: '优化正文结构，提高阅读完成率与互动率。', pointsPerUse: 5 },
  { id: '22', name: '小红书笔记评论生成', category: '小红书', icon: '💬', iconColor: '#dc2626', description: '批量生成高互动评论，提高内容活跃度。', pointsPerUse: 3 },

  { id: '23', name: '毛泽东战略智能体', category: '企业教练', icon: '🚩', iconColor: '#dc2626', description: '以战略视角分析复杂问题，拆解关键矛盾。', pointsPerUse: 10 },
  { id: '24', name: '乔布斯产品教练', category: '企业教练', icon: '📱', iconColor: '#1e293b', description: '围绕用户体验与产品本质优化方案。', pointsPerUse: 10 },
  { id: '25', name: '张一鸣商业教练', category: '企业教练', icon: '📊', iconColor: '#2563eb', description: '数据驱动决策，建立可验证增长机制。', pointsPerUse: 10 },

  { id: '26', name: '降税模型测算', category: '财税', icon: '🧮', iconColor: '#059669', description: '评估不同方案的税负影响，支持合规优化。', pointsPerUse: 8 },
  { id: '27', name: '股权架构设计', category: '财税', icon: '🔀', iconColor: '#7c3aed', description: '设计更稳健的股权结构与控制权安排。', pointsPerUse: 10 },
  { id: '28', name: '电商平台专项合规', category: '财税', icon: '🛡️', iconColor: '#2563eb', description: '梳理平台规则与税务合规重点，规避风险。', pointsPerUse: 8 },
  { id: '29', name: '薪酬与个税规划', category: '财税', icon: '👛', iconColor: '#ea580c', description: '优化薪酬结构，兼顾员工激励与税务合规。', pointsPerUse: 8 },
  { id: '30', name: '预警诊断&稽查', category: '财税', icon: '⚠️', iconColor: '#f59e0b', description: '提前识别税务风险，完善应对与稽查准备。', pointsPerUse: 10 },

  { id: '31', name: 'AI工作流开发需求细化', category: 'AI陪跑教练', icon: '⚙️', iconColor: '#64748b', description: '将模糊想法细化为可执行需求文档。', pointsPerUse: 5 },
  { id: '32', name: '调研访谈-高价值场景', category: 'AI陪跑教练', icon: '🔍', iconColor: '#2563eb', description: '通过调研定位 AI 应用高价值场景。', pointsPerUse: 8 },
  { id: '33', name: '火火提示词调试', category: 'AI陪跑教练', icon: '🧪', iconColor: '#059669', description: '快速调试提示词，提升模型输出稳定性。', pointsPerUse: 3 },
  { id: '34', name: 'AI工作流访谈教练', category: 'AI陪跑教练', icon: '🧠', iconColor: '#7c3aed', description: '梳理流程痛点，设计可落地的 AI 改造路径。', pointsPerUse: 5 },
];

const CATEGORY_ICONS: Record<string, string> = {
  '管理工具': '🧭',
  '电商工具': '📦',
  '小红书': '📕',
  '企业教练': '🏛️',
  '财税': '💼',
  'AI陪跑教练': '🤖',
};

export default function HomePage() {
  const { user, isAuthenticated, isLoading, loadUser } = useAuthStore();
  const { conversations, favorites, loadConversations, toggleFavorite, removeFavorite, deleteConversation } = useConversationsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'history' | 'favorites'>('history');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => { if (isAuthenticated) loadConversations(); }, [isAuthenticated, loadConversations]);

  const requireAuth = (path: string) => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    router.push(path);
  };

  const categories = useMemo(() => [...new Set(MOCK_BOTS.map((b) => b.category))], []);
  const filteredBots = MOCK_BOTS.filter((bot) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return bot.name.toLowerCase().includes(q) || bot.description.toLowerCase().includes(q);
  });

  const botsByCategory = categories.map((cat) => ({
    category: cat,
    icon: CATEGORY_ICONS[cat] || '🧠',
    bots: filteredBots.filter((b) => b.category === cat),
  })).filter((g) => g.bots.length > 0);

  const imageToolMatched = !searchQuery
    || IMAGE_TOOL.name.toLowerCase().includes(searchQuery.toLowerCase())
    || IMAGE_TOOL.description.toLowerCase().includes(searchQuery.toLowerCase());

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

  if (isLoading) return <div className={styles.loading}><div className={styles.spinner} /></div>;

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.sidebarToggle} onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <span className={styles.logoIcon}>🤖</span>
          <h1 className={styles.logo}>电商 AI 智能平台</h1>
        </div>
        <div className={styles.headerCenter}>
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}>🔍</span>
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
          <button onClick={() => requireAuth('/workflow-builder')} className={styles.navBtn}>工作流</button>
          {mounted && (
            <button
              className={styles.themeToggle}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          )}
          {isAuthenticated ? (
            <>
              <div className={styles.pointsBadge}>💎 {user?.pointsBalance ?? 0} 积分</div>
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
            <button className={`${styles.sidebarTabBtn} ${sidebarTab === 'history' ? styles.sidebarTabActive : ''}`} onClick={() => setSidebarTab('history')}>对话历史</button>
            <button className={`${styles.sidebarTabBtn} ${sidebarTab === 'favorites' ? styles.sidebarTabActive : ''}`} onClick={() => setSidebarTab('favorites')}>收藏</button>
          </div>
          <div className={styles.sidebarList}>
            {sidebarConvs.length === 0 ? (
              <div className={styles.sidebarEmpty}>{sidebarTab === 'favorites' ? '暂无收藏对话' : '暂无对话记录'}</div>
            ) : sidebarConvs.map((conv) => (
              <div key={conv.id} className={styles.sidebarItem} onClick={() => router.push(`/chat/${conv.botId}?cid=${conv.id}`)}>
                <div className={styles.sidebarItemTop}>
                  <span className={styles.sidebarBotName}>{conv.botName || '机器人'}</span>
                  <span className={styles.sidebarTime}>{formatTime(conv.updatedAt)}</span>
                </div>
                <p className={styles.sidebarPreview}>{getLastMsg(conv)}</p>
                <div className={styles.sidebarActions}>
                  <button className={styles.sidebarActionBtn} onClick={(e) => { e.stopPropagation(); toggleFavorite(conv.id); }}>{conv.isFavorite ? '★' : '☆'}</button>
                  <button className={styles.sidebarActionBtn} onClick={(e) => { e.stopPropagation(); sidebarTab === 'favorites' ? removeFavorite(conv.id) : deleteConversation(conv.id); }}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className={styles.main}>
          <div className={styles.welcome}>
            <h2>{isAuthenticated ? `欢迎回来，${user?.nickname}` : '欢迎来到电商 AI 智能平台'}</h2>
            <p className={styles.welcomeSub}>{isAuthenticated ? '今天想先做哪项任务？' : '浏览全部机器人，快速开始你的业务任务。'}</p>
          </div>

          <div className={styles.workflowCards}>
            {WORKFLOW_CARDS.map((wf) => (
              <div key={wf.id} className={styles.wfCard} style={{ background: wf.gradient }} onClick={() => requireAuth('/workflow-builder')}>
                <h3 className={styles.wfCardTitle}>⚡ {wf.title}</h3>
                <div className={styles.wfSteps}>
                  {wf.steps.map((s, i) => <span key={i}>{s}{i < wf.steps.length - 1 && <span className={styles.wfArrow}> → </span>}</span>)}
                </div>
                <button className={styles.wfLaunchBtn}>立即启动</button>
              </div>
            ))}
          </div>

          {imageToolMatched && (
            <div className={styles.categorySection}>
              <h3 className={styles.categoryTitle}>🧩 {IMAGE_TOOL.category}</h3>
              <div className={styles.botGrid}>
                <div className={styles.botCard} onClick={() => router.push(IMAGE_TOOL.route)}>
                  <div className={styles.botIcon} style={{ background: IMAGE_TOOL.iconColor + '15', color: IMAGE_TOOL.iconColor }}>{IMAGE_TOOL.icon}</div>
                  <div className={styles.botInfo}>
                    <h4 className={styles.botName}>{IMAGE_TOOL.name}</h4>
                    <p className={styles.botDesc}>{IMAGE_TOOL.description}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {botsByCategory.map((group) => (
            <div key={group.category} className={styles.categorySection}>
              <h3 className={styles.categoryTitle}>{group.icon} {group.category}</h3>
              <div className={styles.botGrid}>
                {group.bots.map((bot) => (
                  <div key={bot.id} className={styles.botCard} onClick={() => requireAuth(`/chat/${bot.id}`)}>
                    <div className={styles.botIcon} style={{ background: bot.iconColor + '15', color: bot.iconColor }}>{bot.icon}</div>
                    <div className={styles.botInfo}>
                      <h4 className={styles.botName}>{bot.name}</h4>
                      <p className={styles.botDesc}>{bot.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {!imageToolMatched && filteredBots.length === 0 && (
            <div className={styles.empty}><p>没有找到匹配的机器人</p></div>
          )}
        </main>
      </div>

      <div className={styles.mobileNav}>
        <button className={styles.mobileNavBtn} onClick={() => router.push('/')}><span>🏠</span>首页</button>
        <button className={styles.mobileNavBtn} onClick={() => requireAuth('/workflow-builder')}><span>⚡</span>工作流</button>
        <button className={styles.mobileNavBtn} onClick={() => router.push('/bot/image-generator')}><span>🖼️</span>绘图</button>
        <button className={styles.mobileNavBtn} onClick={() => requireAuth('/profile')}><span>👤</span>我的</button>
      </div>
    </div>
  );
}
