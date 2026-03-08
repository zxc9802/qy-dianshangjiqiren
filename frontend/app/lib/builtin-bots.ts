export interface BuiltinBotDefinition {
    routeId: string;
    name: string;
    category: string;
    icon: string;
    description: string;
    pointsPerUse: number;
    welcome: string;
}

export const BUILTIN_BOTS: BuiltinBotDefinition[] = [
    { routeId: '1', name: 'KPI教练', category: '管理工具', icon: 'target', description: '设计可量化的 KPI 体系，让团队目标清晰可追踪。', pointsPerUse: 5, welcome: '你好，你们团队现在是怎么做绩效考核的？' },
    { routeId: '2', name: 'SOP梳理AI教练', category: '管理工具', icon: 'list-checks', description: '把经验沉淀成标准流程，提升组织复制效率。', pointsPerUse: 5, welcome: '你好，你想梳理哪个环节的流程？' },
    { routeId: '3', name: 'OKR教练', category: '管理工具', icon: 'goal', description: '聚焦战略目标，用 OKR 帮团队上下对齐。', pointsPerUse: 5, welcome: '你好，你们今年最重要的目标是什么？' },
    { routeId: '4', name: '电商商业顾问', category: '管理工具', icon: 'briefcase', description: '多维度分析业务问题，给出可执行的增长建议。', pointsPerUse: 8, welcome: '你好，说说你现在遇到的业务问题。' },
    { routeId: '5', name: '招聘教练', category: '管理工具', icon: 'users', description: '从岗位画像到面试评估，优化招聘全流程。', pointsPerUse: 5, welcome: '你好，最近在招什么岗位？' },
    { routeId: '6', name: 'AI通用助手', category: '管理工具', icon: 'bot', description: '写作、分析、总结、改写等通用任务处理。', pointsPerUse: 3, welcome: '你好，说说你的需求。' },
    { routeId: '7', name: '一键出10图提示词', category: '电商工具', icon: 'image', description: '快速生成多套电商出图提示词，覆盖不同场景。', pointsPerUse: 8, welcome: '你好，你的产品是什么？' },
    { routeId: '8', name: '天猫爆款趋势拆解', category: '电商工具', icon: 'trending-up', description: '拆解类目趋势逻辑，发现潜在爆款机会。', pointsPerUse: 8, welcome: '你好，你想看哪个品类的趋势？' },
    { routeId: '9', name: '卖点教练', category: '电商工具', icon: 'zap', description: '提炼核心卖点，形成更强购买转化表达。', pointsPerUse: 5, welcome: '你好，你的产品是什么？' },
    { routeId: '10', name: '天猫主图策划教练', category: '电商工具', icon: 'layout', description: '输出主图结构、视觉层级与点击优化策略。', pointsPerUse: 5, welcome: '你好，你的产品是什么？目前主图点击率怎么样？' },
    { routeId: '11', name: '爆款裂变分析AI教练', category: '电商工具', icon: 'git-branch', description: '拆解爆款可复制元素，扩展到更多人群与场景。', pointsPerUse: 8, welcome: '你好，你想复制哪个爆款的打法？' },
    { routeId: '12', name: '天猫评价教练', category: '电商工具', icon: 'star', description: '优化评价内容结构，提升信任与转化。', pointsPerUse: 5, welcome: '你好，你是什么品类的？' },
    { routeId: '13', name: '天猫竞争策略教练', category: '电商工具', icon: 'swords', description: '分析竞品优劣势，制定差异化竞争方案。', pointsPerUse: 8, welcome: '你好，你想分析哪个竞品？' },
    { routeId: '14', name: '天猫客单价提升教练', category: '电商工具', icon: 'dollar-sign', description: '通过组合策略与定价设计提升客单价。', pointsPerUse: 5, welcome: '你好，你目前客单价多少？卖什么品类的？' },
    { routeId: '15', name: '小红书爆文封面拆解', category: '小红书', icon: 'camera', description: '拆解封面构图、配色与文案排版，提炼爆点模板。', pointsPerUse: 5, welcome: '你好，把爆文封面发过来看看。' },
    { routeId: '16', name: '小红书私域搭建SOP', category: '小红书', icon: 'link', description: '设计合规引流路径，打通公域到私域转化。', pointsPerUse: 8, welcome: '你好，你目前小红书粉丝量级有多少？' },
    { routeId: '17', name: '小红书爆文拆解复制', category: '小红书', icon: 'copy', description: '逆向拆解爆文，沉淀可复用创作方法。', pointsPerUse: 5, welcome: '你好，把想拆解的爆文发过来。' },
    { routeId: '18', name: '小红书爆款标题', category: '小红书', icon: 'type', description: '生成多套高点击标题并给出使用建议。', pointsPerUse: 3, welcome: '你好，你做什么方向的内容？' },
    { routeId: '19', name: '小红书起号话题', category: '小红书', icon: 'rocket', description: '为新账号制定起号阶段的话题与内容方向。', pointsPerUse: 5, welcome: '你好，你的账号定位和目标人群是什么？' },
    { routeId: '20', name: '小红书达人SOP流程', category: '小红书', icon: 'clipboard', description: '规范达人合作流程，从筛选到复盘闭环。', pointsPerUse: 8, welcome: '你好，你的产品是什么？预算大概多少？' },
    { routeId: '21', name: '小红书正文拆解SOP', category: '小红书', icon: 'file-text', description: '优化正文结构，提升阅读完成率与互动率。', pointsPerUse: 5, welcome: '你好，把想拆解的爆文发过来。' },
    { routeId: '22', name: '小红书笔记评论生成', category: '小红书', icon: 'message-circle', description: '批量生成高互动评论，提高内容活跃度。', pointsPerUse: 3, welcome: '你好，你是什么产品？想营造什么样的评论氛围？' },
    { routeId: '23', name: '毛泽东战略智能体', category: '企业教练', icon: 'flag', description: '以战略视角分析复杂问题，拆解关键矛盾。', pointsPerUse: 10, welcome: '你好，说说你现在面对的挑战。' },
    { routeId: '24', name: '乔布斯产品教练', category: '企业教练', icon: 'smartphone', description: '围绕用户体验与产品本质优化方案。', pointsPerUse: 10, welcome: '你好，你的产品解决的是什么问题？' },
    { routeId: '25', name: '张一鸣商业教练', category: '企业教练', icon: 'bar-chart', description: '数据驱动决策，建立可验证增长机制。', pointsPerUse: 10, welcome: '你好，你想分析什么问题？' },
    { routeId: '26', name: '降税模型测算', category: '财税', icon: 'calculator', description: '评估不同方案的税负影响，支持合规优化。', pointsPerUse: 8, welcome: '你好，你的企业类型和年营收大概多少？' },
    { routeId: '27', name: '股权架构设计', category: '财税', icon: 'git-merge', description: '设计更稳健的股权结构与控制权安排。', pointsPerUse: 10, welcome: '你好，你们目前几个合伙人？股权怎么分的？' },
    { routeId: '28', name: '电商平台专项合规', category: '财税', icon: 'shield', description: '梳理平台规则与税务合规重点，规避风险。', pointsPerUse: 8, welcome: '你好，你在哪个平台经营？' },
    { routeId: '29', name: '薪酬与个税规划', category: '财税', icon: 'wallet', description: '优化薪酬结构，兼顾激励与税务合规。', pointsPerUse: 8, welcome: '你好，你们团队多少人？现在薪酬结构是怎样的？' },
    { routeId: '30', name: '预警诊断&稽查', category: '财税', icon: 'alert-triangle', description: '提前识别税务风险，完善应对与稽查准备。', pointsPerUse: 10, welcome: '你好，说说你担心的税务问题。' },
    { routeId: '31', name: 'AI工作流开发需求细化', category: 'AI陪跑教练', icon: 'settings', description: '将模糊想法细化为可执行需求文档。', pointsPerUse: 5, welcome: '你好，你想用 AI 解决什么业务场景？' },
    { routeId: '32', name: '调研访谈-高价值场景', category: 'AI陪跑教练', icon: 'search', description: '通过调研定位 AI 应用高价值场景。', pointsPerUse: 8, welcome: '你好，你们是做什么业务的？' },
    { routeId: '33', name: '火火提示词调试', category: 'AI陪跑教练', icon: 'terminal', description: '快速调试提示词，提升模型输出稳定性。', pointsPerUse: 3, welcome: '你好，把你的提示词发过来看看。' },
    { routeId: '34', name: 'AI工作流访谈教练', category: 'AI陪跑教练', icon: 'git-pull-request', description: '梳理流程痛点，设计可落地的 AI 改造路径。', pointsPerUse: 5, welcome: '你好，说说你的业务流程。' },
];

export const BUILTIN_BOT_MAP = Object.fromEntries(
    BUILTIN_BOTS.map((bot) => [bot.routeId, bot]),
) as Record<string, BuiltinBotDefinition>;
