'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

const BOT_NAMES: Record<string, string> = {
  '1': 'KPI教练', '2': 'SOP梳理AI教练', '3': 'OKR教练', '4': '电商商业顾问',
  '5': '招聘教练', '6': 'AI通用助手', '7': '一键出10图提示词', '8': '天猫爆款趋势拆解',
  '9': '卖点教练', '10': '天猫主图策划教练', '11': '爆款裂变分析AI教练', '12': '天猫评价教练',
  '13': '天猫竞争策略教练', '14': '天猫客单价提升教练', '15': '小红书爆文封面拆解',
  '16': '小红书私域搭建SOP', '17': '小红书爆文拆解复制', '18': '小红书爆款标题',
  '19': '小红书起号话题', '20': '小红书达人SOP流程', '21': '小红书正文拆解SOP',
  '22': '小红书笔记评论生成', '23': '毛泽东战略智能体', '24': '乔布斯产品教练',
  '25': '张一鸣商业教练', '26': '降税模型测算', '27': '股权架构设计',
  '28': '电商平台专项合规', '29': '薪酬与个税规划', '30': '预警诊断&稽查',
  '31': 'AI工作流开发需求细化', '32': '调研访谈—高价值场景', '33': '火火提示词调试',
  '34': 'AI工作流访谈教练',
};

const MOCK_BOTS: BotInfo[] = [
  { id: '1', name: 'KPI教练', category: '管理工具', icon: '🎯', iconColor: '#2563eb', description: '设定与追踪团队目标，AI提供优化建议', pointsPerUse: 5 },
  { id: '2', name: 'SOP梳理AI教练', category: '管理工具', icon: '📋', iconColor: '#7c3aed', description: '把经验变成标准流程，新人快速上手', pointsPerUse: 5 },
  { id: '3', name: 'OKR教练', category: '管理工具', icon: '🎯', iconColor: '#059669', description: '聚焦战略目标，用OKR让团队对齐', pointsPerUse: 5 },
  { id: '4', name: '电商商业顾问', category: '管理工具', icon: '💼', iconColor: '#dc2626', description: '多位商业领袖思维的AI战略顾问', pointsPerUse: 8 },
  { id: '5', name: '招聘教练', category: '管理工具', icon: '👥', iconColor: '#ea580c', description: '电商行业招聘专家，全流程指导', pointsPerUse: 5 },
  { id: '6', name: 'AI通用助手', category: '管理工具', icon: '🤖', iconColor: '#2563eb', description: '写作、分析、翻译、计算、头脑风暴', pointsPerUse: 3 },
  { id: '7', name: '一键出10图提示词', category: '电商工具', icon: '🖼️', iconColor: '#7c3aed', description: '从产品分析到使用场景，输出AI出图提示词', pointsPerUse: 8 },
  { id: '8', name: '天猫爆款趋势拆解', category: '电商工具', icon: '📈', iconColor: '#2563eb', description: '用数据思维拆解天猫爆款逻辑', pointsPerUse: 8 },
  { id: '9', name: '卖点教练', category: '电商工具', icon: '⚡', iconColor: '#ea580c', description: '找到产品的超级卖点，让消费者下单', pointsPerUse: 5 },
  { id: '10', name: '天猫主图策划教练', category: '电商工具', icon: '🎨', iconColor: '#059669', description: '策划高点击率的天猫主图', pointsPerUse: 5 },
  { id: '11', name: '爆款裂变分析AI教练', category: '电商工具', icon: '🔀', iconColor: '#dc2626', description: '把爆款经验复制裂变到新场景', pointsPerUse: 8 },
  { id: '12', name: '天猫评价教练', category: '电商工具', icon: '⭐', iconColor: '#f59e0b', description: '设计高转化率的评价内容框架', pointsPerUse: 5 },
  { id: '13', name: '天猫竞争策略教练', category: '电商工具', icon: '⚔️', iconColor: '#7c3aed', description: '系统性分析竞争对手', pointsPerUse: 8 },
  { id: '14', name: '天猫客单价提升教练', category: '电商工具', icon: '💰', iconColor: '#059669', description: '组合策略提升客单价', pointsPerUse: 5 },
  { id: '15', name: '小红书爆文封面拆解', category: '小红书', icon: '📸', iconColor: '#dc2626', description: '拆解爆文封面构图、色彩、文字排版', pointsPerUse: 5 },
  { id: '16', name: '小红书私域搭建SOP', category: '小红书', icon: '🔗', iconColor: '#2563eb', description: '合规引流，公域流量导入私域', pointsPerUse: 8 },
  { id: '17', name: '小红书爆文拆解复制', category: '小红书', icon: '📝', iconColor: '#7c3aed', description: '逆向工程爆款笔记，提炼创作公式', pointsPerUse: 5 },
  { id: '18', name: '小红书爆款标题', category: '小红书', icon: '✏️', iconColor: '#ea580c', description: '10000+爆文标题规律研究', pointsPerUse: 3 },
  { id: '19', name: '小红书起号话题', category: '小红书', icon: '🚀', iconColor: '#059669', description: '帮新账号快速度过冷启动期', pointsPerUse: 5 },
  { id: '20', name: '小红书达人SOP流程', category: '小红书', icon: '📑', iconColor: '#f59e0b', description: '系统化KOL合作全流程', pointsPerUse: 8 },
  { id: '21', name: '小红书正文拆解SOP', category: '小红书', icon: '📄', iconColor: '#2563eb', description: '拆解爆款正文结构，提炼写作公式', pointsPerUse: 5 },
  { id: '22', name: '小红书笔记评论生成', category: '小红书', icon: '💬', iconColor: '#dc2626', description: '设计高互动率的评论内容', pointsPerUse: 3 },
  { id: '23', name: '毛泽东战略智能体', category: '企业教练', icon: '🚩', iconColor: '#dc2626', description: '矛盾论、持久战等思维框架分析商业', pointsPerUse: 10 },
  { id: '24', name: '乔布斯产品教练', category: '企业教练', icon: '📱', iconColor: '#1e293b', description: '极致简约、用户体验至上的产品思维', pointsPerUse: 10 },
  { id: '25', name: '张一鸣商业教练', category: '企业教练', icon: '📊', iconColor: '#2563eb', description: '数据驱动、反直觉的商业决策分析', pointsPerUse: 10 },
  { id: '26', name: '降税模型测算', category: '财税', icon: '🧮', iconColor: '#059669', description: '合规省钱，合理架构降低税负', pointsPerUse: 8 },
  { id: '27', name: '股权架构设计', category: '财税', icon: '🔀', iconColor: '#7c3aed', description: '股权结构设计与控制权保护', pointsPerUse: 10 },
  { id: '28', name: '电商平台专项合规', category: '财税', icon: '🛡️', iconColor: '#2563eb', description: '各平台税务合规与优化', pointsPerUse: 8 },
  { id: '29', name: '薪酬与个税规划', category: '财税', icon: '👛', iconColor: '#ea580c', description: '合理薪酬结构，降低用工成本', pointsPerUse: 8 },
  { id: '30', name: '预警诊断&稽查', category: '财税', icon: '⚠️', iconColor: '#f59e0b', description: '排查税务风险，准备应对预案', pointsPerUse: 10 },
  { id: '31', name: 'AI工作流开发需求细化', category: 'AI陪跑教练', icon: '⚙️', iconColor: '#64748b', description: '把AI想法细化成可执行需求文档', pointsPerUse: 5 },
  { id: '32', name: '调研访谈—高价值场景', category: 'AI陪跑教练', icon: '🔍', iconColor: '#2563eb', description: '结构化访谈发现高价值AI场景', pointsPerUse: 8 },
  { id: '33', name: '火火提示词调试', category: 'AI陪跑教练', icon: '💻', iconColor: '#059669', description: 'AI提示词编写、调试与优化', pointsPerUse: 3 },
  { id: '34', name: 'AI工作流访谈教练', category: 'AI陪跑教练', icon: '🔄', iconColor: '#7c3aed', description: '找到最值得用AI改造的关键场景', pointsPerUse: 5 },
];

const CATEGORY_ICONS: Record<string, string> = {
  '管理工具': '📋', '电商工具': '🛒', '小红书': '📕',
  '企业教练': '👔', '财税': '💰', 'AI陪跑教练': '🤖',
};

export default function HomePage() {
  const { user, isAuthenticated, isLoading, loadUser } = useAuthStore();
  const { conversations, favorites, loadConversations, toggleFavorite, removeFavorite, deleteConversation } = useConversationsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'history' | 'favorites'>('history');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const router = useRouter();

  useEffect(() => { loadUser(); loadConversations(); }, [loadUser, loadConversations]);
  useEffect(() => { if (!isLoading && !isAuthenticated) router.push('/login'); }, [isLoading, isAuthenticated, router]);

  const categories = [...new Set(MOCK_BOTS.map(b => b.category))];
  const filteredBots = MOCK_BOTS.filter(bot => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return bot.name.toLowerCase().includes(q) || bot.description.toLowerCase().includes(q);
  });
  const botsByCategory = categories.map(cat => ({
    category: cat, icon: CATEGORY_ICONS[cat] || '📦',
    bots: filteredBots.filter(b => b.category === cat),
  })).filter(g => g.bots.length > 0);

  const sidebarConvs = (sidebarTab === 'favorites' ? favorites : conversations)
    .slice().sort((a, b) => b.updatedAt - a.updatedAt);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const getLastMsg = (conv: typeof conversations[0]) => {
    const last = conv.messages[conv.messages.length - 1];
    return last ? last.content.replace(/\[文件:.*?\]/g, '[文件]').slice(0, 40) : '';
  };

  if (isLoading) return <div className={styles.loading}><div className={styles.spinner} /></div>;
  if (!isAuthenticated) return null;

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.sidebarToggle} onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <span className={styles.logoIcon}>🤖</span>
          <h1 className={styles.logo}>电商AI智能平台</h1>
        </div>
        <div className={styles.headerCenter}>
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}>🔍</span>
            <input type="text" placeholder="搜索智能体..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className={styles.searchInput} />
          </div>
        </div>
        <div className={styles.headerRight}>
          <button onClick={() => router.push('/workflow')} className={styles.navBtn}>⚡ 工作流</button>
          <div className={styles.pointsBadge}>💰 {user?.pointsBalance ?? 0} 积分</div>
          <button onClick={() => router.push('/profile')} className={styles.avatarBtn}>{user?.nickname?.slice(0, 1) || '用'}</button>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
          <div className={styles.sidebarTabs}>
            <button className={`${styles.sidebarTabBtn} ${sidebarTab === 'history' ? styles.sidebarTabActive : ''}`} onClick={() => setSidebarTab('history')}>💬 对话历史</button>
            <button className={`${styles.sidebarTabBtn} ${sidebarTab === 'favorites' ? styles.sidebarTabActive : ''}`} onClick={() => setSidebarTab('favorites')}>⭐ 收藏</button>
          </div>
          <div className={styles.sidebarList}>
            {sidebarConvs.length === 0 ? (
              <div className={styles.sidebarEmpty}>{sidebarTab === 'favorites' ? '暂无收藏对话' : '暂无对话记录'}</div>
            ) : sidebarConvs.map(conv => (
              <div key={conv.id} className={styles.sidebarItem} onClick={() => router.push(`/chat/${conv.botId}?cid=${conv.id}`)}>
                <div className={styles.sidebarItemTop}>
                  <span className={styles.sidebarBotName}>{BOT_NAMES[conv.botId] || conv.botName}</span>
                  <span className={styles.sidebarTime}>{formatTime(conv.updatedAt)}</span>
                </div>
                <p className={styles.sidebarPreview}>{getLastMsg(conv)}</p>
                <div className={styles.sidebarActions}>
                  <button className={styles.sidebarActionBtn} onClick={(e) => { e.stopPropagation(); toggleFavorite(conv.id); }}>{conv.isFavorite ? '⭐' : '☆'}</button>
                  <button className={styles.sidebarActionBtn} onClick={(e) => { e.stopPropagation(); sidebarTab === 'favorites' ? removeFavorite(conv.id) : deleteConversation(conv.id); }}>🗑️</button>
                </div>
              </div>
            ))}
          </div>

        </aside>

        <main className={styles.main}>
          <div className={styles.welcome}>
            <h2>欢迎回来，{user?.nickname}！</h2>
            <p className={styles.welcomeSub}>今天需要什么帮助？</p>
          </div>
          <div className={styles.workflowCards}>
            {WORKFLOW_CARDS.map(wf => (
              <div key={wf.id} className={styles.wfCard} style={{ background: wf.gradient }} onClick={() => router.push('/workflow')}>
                <h3 className={styles.wfCardTitle}>⚡ {wf.title}</h3>
                <div className={styles.wfSteps}>{wf.steps.map((s, i) => <span key={i}>{s}{i < wf.steps.length - 1 && <span className={styles.wfArrow}> → </span>}</span>)}</div>
                <button className={styles.wfLaunchBtn}>立即启动</button>
              </div>
            ))}
          </div>
          {botsByCategory.map(group => (
            <div key={group.category} className={styles.categorySection}>
              <h3 className={styles.categoryTitle}>{group.icon} {group.category}</h3>
              <div className={styles.botGrid}>
                {group.bots.map(bot => (
                  <div key={bot.id} className={styles.botCard} onClick={() => router.push(`/chat/${bot.id}`)}>
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
          {filteredBots.length === 0 && <div className={styles.empty}><p>没有找到匹配的智能体</p></div>}
        </main>
      </div>

      <div className={styles.mobileNav}>
        <button className={styles.mobileNavBtn} onClick={() => router.push('/')}><span>🏠</span>首页</button>
        <button className={styles.mobileNavBtn} onClick={() => router.push('/workflow')}><span>⚡</span>工作流</button>
        <button className={styles.mobileNavBtn} onClick={() => setSidebarOpen(!sidebarOpen)}><span>💬</span>对话</button>
        <button className={styles.mobileNavBtn} onClick={() => router.push('/profile')}><span>👤</span>我的</button>
      </div>
    </div>
  );
}
