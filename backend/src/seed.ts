import { prisma } from './utils/prisma';
import { getSystemPromptBySortOrder } from './utils/systemPrompts';

const QIYA_ENTERPRISE_MANAGEMENT_PROMPT = [
    '你是“起芽成长特助”，定位是职场成长与管理提效智能体。',
    '你的任务是帮助用户处理升职加薪、SOP、OKR、KPI 制定，以及工作迷茫、成长方向、团队协同与管理提效相关问题。',
    '回答时保持专业、清晰、务实，优先给出可执行结论、判断依据和落地步骤。',
    '如果问题涉及规则、方法论或公司管理口径，优先结合内置知识库回答；如果知识库未覆盖，再用通用管理理解补充。',
    '不要空泛喊口号，也不要大段照抄材料原文。',
].join('\n');

const GENERIC_CHAT_PROMPT = [
    '回答规则：',
    '1. 默认使用中文。',
    '2. 不使用固定人设口吻，不自称，不做角色扮演。',
    '3. 当用户目标、背景、限制条件、对象、优先级或交付形式还不清楚时，先提出 1 到 3 个最关键的澄清问题，再继续给方案。',
    '4. 当信息已经足够时，直接给出结构化、具体、可执行的回答。',
    '5. 如果用户明确要求不要继续追问，就基于合理假设直接回答，并先列出关键假设。',
    '6. 回答避免空话，优先给步骤、判断标准、方案对比和下一步建议。',
].join('\n');

const BOTS = [
    // 管理工具
    { name: '通用聊天', slug: 'generic-chat', category: '管理工具', icon: 'bot', description: '不预设固定人设，先帮你把目标、限制和交付要求问清，再给可执行方案。', pointsPerUse: 3, sortOrder: 36 },
    { name: '起芽成长特助', slug: 'qiya-enterprise-management', category: '管理工具', icon: 'sprout', description: '升职加薪问我，不管是SOP,OKR,KPI如何制定，还是工作中有迷茫都可以找我', pointsPerUse: 8, sortOrder: 35 },
    { name: 'KPI教练', slug: 'kpi-coach', category: '管理工具', icon: 'target', description: '帮你设计可量化的KPI考核体系，让团队目标清晰，绩效公平', pointsPerUse: 5, sortOrder: 1 },
    { name: 'SOP梳理AI教练', slug: 'sop-coach', category: '管理工具', icon: 'list-checks', description: '把脑子里的经验变成纸上的标准流程，新人也能快速上手', pointsPerUse: 5, sortOrder: 2 },
    { name: 'OKR教练', slug: 'okr-coach', category: '管理工具', icon: 'goal', description: '聚焦战略目标，用OKR方法论让团队上下对齐', pointsPerUse: 5, sortOrder: 3 },
    { name: '电商商业顾问', slug: 'business-advisor', category: '管理工具', icon: 'briefcase', description: '融合多位商业领袖思维的AI战略顾问，多视角分析商业问题', pointsPerUse: 8, sortOrder: 4 },
    { name: '招聘教练', slug: 'recruit-coach', category: '管理工具', icon: 'users', description: '电商行业招聘专家，从JD到面试到入职全流程指导', pointsPerUse: 5, sortOrder: 5 },
    { name: 'AI通用助手', slug: 'general-assistant', category: '管理工具', icon: 'bot', description: '智能通用助手，写作、分析、翻译、计算、头脑风暴等', pointsPerUse: 3, sortOrder: 6 },

    // 电商工具
    { name: '一键出10图提示词', slug: 'image-prompts', category: '电商工具', icon: 'image', description: '从产品分析到使用场景，输出10张电商图片的AI出图提示词', pointsPerUse: 8, sortOrder: 7 },
    { name: '天猫爆款趋势拆解', slug: 'tmall-trends', category: '电商工具', icon: 'trending-up', description: '用数据思维拆解天猫爆款逻辑，发现新的市场机会', pointsPerUse: 8, sortOrder: 8 },
    { name: '卖点教练', slug: 'selling-point', category: '电商工具', icon: 'zap', description: '找到产品的超级卖点，让消费者忍不住下单的核心理由', pointsPerUse: 5, sortOrder: 9 },
    { name: '天猫主图策划教练', slug: 'tmall-main-image', category: '电商工具', icon: 'layout', description: '5张主图=一个微型详情页，策划高点击率的天猫主图', pointsPerUse: 5, sortOrder: 10 },
    { name: '爆款裂变分析AI教练', slug: 'viral-analysis', category: '电商工具', icon: 'git-branch', description: '把一个爆款的成功经验复制裂变到新人群、新场景', pointsPerUse: 8, sortOrder: 11 },
    { name: '天猫评价教练', slug: 'tmall-reviews', category: '电商工具', icon: 'star', description: '设计高转化率的评价内容框架，好评也是销售话术', pointsPerUse: 5, sortOrder: 12 },
    { name: '天猫竞争策略教练', slug: 'tmall-competition', category: '电商工具', icon: 'swords', description: '系统性分析竞争对手，找到打赢竞争的切入点', pointsPerUse: 8, sortOrder: 13 },
    { name: '天猫客单价提升教练', slug: 'tmall-aov', category: '电商工具', icon: 'dollar-sign', description: '通过组合策略让用户心甘情愿地买更多或买更贵', pointsPerUse: 5, sortOrder: 14 },

    // 小红书
    { name: '小红书爆文封面拆解', slug: 'xhs-cover', category: '小红书', icon: 'camera', description: '拆解爆文封面的爆点元素，构图、色彩、文字排版全解析', pointsPerUse: 5, sortOrder: 15 },
    { name: '小红书私域搭建SOP', slug: 'xhs-private', category: '小红书', icon: 'link', description: '合规引流，把小红书公域流量导入微信私域', pointsPerUse: 8, sortOrder: 16 },
    { name: '小红书爆文拆解复制', slug: 'xhs-viral-copy', category: '小红书', icon: 'copy', description: '逆向工程爆款笔记，提炼可复用的创作公式', pointsPerUse: 5, sortOrder: 17 },
    { name: '小红书爆款标题', slug: 'xhs-titles', category: '小红书', icon: 'type', description: '10000+爆文标题规律研究，写出高点击的爆款标题', pointsPerUse: 3, sortOrder: 18 },
    { name: '小红书起号话题', slug: 'xhs-startup', category: '小红书', icon: 'rocket', description: '帮新账号快速度过冷启动期的话题策略', pointsPerUse: 5, sortOrder: 19 },
    { name: '小红书达人SOP流程', slug: 'xhs-kol-sop', category: '小红书', icon: 'clipboard', description: '系统化的KOL合作全流程，从选号到复盘', pointsPerUse: 8, sortOrder: 20 },
    { name: '小红书正文拆解SOP', slug: 'xhs-content', category: '小红书', icon: 'file-text', description: '拆解爆款笔记正文结构，提炼写作公式', pointsPerUse: 5, sortOrder: 21 },
    { name: '小红书笔记评论生成', slug: 'xhs-comments', category: '小红书', icon: 'message-circle', description: '评论区是第二个详情页，设计高互动率的评论内容', pointsPerUse: 3, sortOrder: 22 },

    // 企业教练
    { name: '毛泽东战略智能体', slug: 'mao-strategy', category: '企业教练', icon: 'flag', description: '用矛盾论、持久战、游击战术等思维框架分析商业问题', pointsPerUse: 10, sortOrder: 23 },
    { name: '乔布斯产品教练', slug: 'jobs-product', category: '企业教练', icon: 'smartphone', description: '极致简约、追问本质、用户体验至上的产品思维教练', pointsPerUse: 10, sortOrder: 24 },
    { name: '张一鸣商业教练', slug: 'zhangyiming-biz', category: '企业教练', icon: 'bar-chart', description: '数据驱动、反直觉、延迟满足的商业决策分析', pointsPerUse: 10, sortOrder: 25 },

    // 财税
    { name: '降税模型测算', slug: 'tax-reduction', category: '财税', icon: 'calculator', description: '合规省钱，通过合理架构设计降低综合税负', pointsPerUse: 8, sortOrder: 26 },
    { name: '股权架构设计', slug: 'equity-design', category: '财税', icon: 'git-merge', description: '股权结构设计与控制权保护，帮你守住钱', pointsPerUse: 10, sortOrder: 27 },
    { name: '电商平台专项合规', slug: 'platform-compliance', category: '财税', icon: 'shield', description: '天猫京东拼多多各平台的税务合规要求与优化', pointsPerUse: 8, sortOrder: 28 },
    { name: '薪酬与个税规划', slug: 'salary-tax', category: '财税', icon: 'wallet', description: '设计合理薪酬结构，降低团队个税和用工成本', pointsPerUse: 8, sortOrder: 29 },
    { name: '预警诊断&稽查', slug: 'tax-audit', category: '财税', icon: 'alert-triangle', description: '排查税务风险，提前准备稽查应对预案', pointsPerUse: 10, sortOrder: 30 },

    // AI陪跑教练
    { name: 'AI工作流开发需求细化', slug: 'ai-workflow-req', category: 'AI陪跑教练', icon: 'settings', description: '把模糊的AI想法细化成可执行的需求文档', pointsPerUse: 5, sortOrder: 31 },
    { name: '调研访谈—高价值场景', slug: 'ai-interview', category: 'AI陪跑教练', icon: 'search', description: '通过结构化访谈发现企业中高价值的AI应用场景', pointsPerUse: 8, sortOrder: 32 },
    { name: '火火提示词调试', slug: 'prompt-debug', category: 'AI陪跑教练', icon: 'terminal', description: 'AI提示词编写、调试与优化，让AI精准输出', pointsPerUse: 3, sortOrder: 33 },
    { name: 'AI工作流访谈教练', slug: 'ai-workflow-coach', category: 'AI陪跑教练', icon: 'git-pull-request', description: '找到业务流程中最值得用AI改造的关键场景', pointsPerUse: 5, sortOrder: 34 },
];

async function seed() {
    console.log('Seeding 36 bots...');

    for (const bot of BOTS) {
        const systemPrompt = bot.sortOrder === 35
            ? QIYA_ENTERPRISE_MANAGEMENT_PROMPT
            : bot.sortOrder === 36
                ? GENERIC_CHAT_PROMPT
                : getSystemPromptBySortOrder(bot.sortOrder, `你是${bot.name}，请给出专业、结构化、可执行的建议。`);
        await prisma.bot.upsert({
            where: { slug: bot.slug },
            update: { ...bot, systemPrompt },
            create: { ...bot, systemPrompt },
        });
    }

    // 创建测试兑换码
    const testCodes = ['TEST100', 'TEST500', 'TEST1000'];
    const testAmounts = [100, 500, 1000];
    for (let i = 0; i < testCodes.length; i++) {
        await prisma.redeemCode.upsert({
            where: { code: testCodes[i] },
            update: {},
            create: { code: testCodes[i], pointsAmount: testAmounts[i] },
        });
    }

    console.log('Seed complete: 36 bots + 3 test redeem codes');
}

seed()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
