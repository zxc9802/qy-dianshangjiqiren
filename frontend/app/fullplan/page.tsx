'use client';

import { useState, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/auth';
import styles from './fullplan.module.css';
import {
    Search, Swords, Zap, Palette, FileText, Star, BookOpen,
    Coins, Target, Rocket, CheckCircle, Loader2, XCircle,
    ArrowLeft, Square,
} from 'lucide-react';

interface PlanStep {
    id: string;
    title: string;
    icon: ReactNode;
    description: string;
    prompt: string;
    status: 'waiting' | 'running' | 'done' | 'error';
    result: string;
}

const PLAN_STEPS: Omit<PlanStep, 'status' | 'result'>[] = [
    { id: 'market', title: '市场分析', icon: <Search size={18} />, description: '分析市场趋势、价格带、人群画像', prompt: '你是电商市场分析专家。请对以下产品做详细市场分析：\n\n{input}\n\n请从以下维度分析：\n1. 市场规模和增长趋势\n2. 价格带分布（低/中/高端占比）\n3. 目标人群画像（年龄、性别、消费习惯）\n4. 市场机会和风险\n5. 季节性趋势\n\n用数据化、结构化的方式输出，包含具体数字估算。' },
    { id: 'competitor', title: '竞品扫描', icon: <Swords size={18} />, description: '分析TOP竞品的产品、定价、流量策略', prompt: '你是电商竞争策略专家。基于以下产品信息和前面的市场分析，做竞品分析：\n\n产品：{input}\n市场分析：{prev}\n\n请输出：\n1. TOP5竞品对比表（产品名、价格、月销、评分、核心卖点）\n2. 各竞品的差异化策略\n3. 竞品的流量来源分析\n4. 可切入的竞争空白点\n5. 建议的差异化定位\n\n用表格和要点形式输出。' },
    { id: 'selling', title: '超级卖点', icon: <Zap size={18} />, description: '提炼3个核心卖点 + FAB分析', prompt: '你是卖点提炼专家。基于以下产品信息和之前的市场竞品分析，提炼超级卖点：\n\n产品：{input}\n前序分析：{prev}\n\n请输出：\n1. 3个超级卖点（每个包含FAB分析：Feature特点、Advantage优势、Benefit利益点）\n2. 30字以内的核心广告语\n3. 每个卖点对应的使用场景\n4. 与竞品的差异化话术\n5. 适合放在主图上的3句话\n\n要求：口语化、有画面感、能打动消费者。' },
    { id: 'mainimg', title: '主图策划', icon: <Palette size={18} />, description: '策划天猫5张主图方案', prompt: '你是天猫主图策划专家。基于以下产品和卖点，策划5张主图：\n\n产品：{input}\n卖点：{prev}\n\n请输出每张主图的详细方案：\n- 第1张（首图/点击图）：构图、文案、视觉重点\n- 第2张（核心卖点图）：展示方式、排版建议\n- 第3张（场景/情感图）：使用场景、氛围\n- 第4张（对比/数据图）：对比维度、呈现方式\n- 第5张（促销/行动图）：促销信息、CTA\n\n每张图包含：构图描述、主标题（8字内）、副标题、配色建议、AI出图提示词（英文）。' },
    { id: 'detail', title: '详情页框架', icon: <FileText size={18} />, description: '生成完整的详情页文案结构', prompt: '你是电商详情页文案专家。基于以下产品和之前的分析，生成完整详情页：\n\n产品：{input}\n参考：{prev}\n\n请输出详情页结构（从上到下）：\n1. 开屏大图文案（一句话戛中痛点）\n2. 核心卖点展示区（3个卖点各配标题+说明+场景图建议）\n3. 产品参数表\n4. 使用场景展示（4个场景）\n5. 对比优势图（vs竞品对比表）\n6. 用户好评展示区（6条模拟好评）\n7. 品牌故事段\n8. 售后保障区\n\n每个模块都包含：标题、正文、视觉建议。' },
    { id: 'review', title: '评价模板', icon: <Star size={18} />, description: '生成20条种子评价', prompt: '你是天猫评价内容策划专家。基于以下产品和卖点，生成种子评价：\n\n产品：{input}\n卖点：{prev}\n\n请生成20条不同视角的买家好评（分类输出）：\n- 5条"首次使用"视角\n- 5条"对比竞品"视角\n- 5条"送礼/推荐"视角\n- 5条"回购/长期使用"视角\n\n要求：口语化、有细节、有情感、长度100-200字、包含具体使用场景。每条标注建议星级和晒图建议。' },
    { id: 'xiaohongshu', title: '小红书种草', icon: <BookOpen size={18} />, description: '生成5篇小红书笔记初稿', prompt: '你是小红书爆文写手。基于以下产品信息，生成5篇种草笔记：\n\n产品：{input}\n卖点：{prev}\n\n5篇笔记类型：\n1. 开箱测评文（详细测评体验）\n2. 合集种草文（XX元好物合集）\n3. 场景安利文（特定场景推荐）\n4. 对比测评文（vs竞品真实对比）\n5. 干货攻略文（选购指南类）\n\n每篇包含：\n- 标题（3个备选，含emoji）\n- 正文（800字左右，口语化，多emoji）\n- 标签（10个#话题标签）\n- 封面拍摄建议\n\n风格：真实、种草感强、像真人分享。' },
    { id: 'pricing', title: '定价策略', icon: <Coins size={18} />, description: '输出阶梯定价 + 促销方案', prompt: '你是电商定价策略专家。基于以下产品和市场竞品分析，制定定价策略：\n\n产品：{input}\n参考：{prev}\n\n请输出：\n1. 建议零售价（含定价逻辑推导过程）\n2. SKU价格体系（基础款/标准款/豪华款）\n3. 上市前90天促销节奏表\n4. 优惠券设计方案（面额、门槛、投放渠道）\n5. 满减活动方案\n6. 利润率测算表\n7. 价格锚定策略\n\n用表格和具体数字输出。' },
];

export default function FullPlanPage() {
    const router = useRouter();
    const { user } = useAuthStore();
    const [productInput, setProductInput] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [steps, setSteps] = useState<PlanStep[]>([]);
    const [currentStep, setCurrentStep] = useState(-1);
    const abortRef = useRef(false);
    const resultsRef = useRef<HTMLDivElement>(null);

    const runPlan = async () => {
        if (!productInput.trim() || isRunning) return;
        abortRef.current = false;

        const initialSteps: PlanStep[] = PLAN_STEPS.map(s => ({
            ...s, status: 'waiting', result: '',
        }));
        setSteps(initialSteps);
        setIsRunning(true);

        let prevResult = '';

        for (let i = 0; i < initialSteps.length; i++) {
            if (abortRef.current) break;
            setCurrentStep(i);
            setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'running' } : s));

            // Scroll to current step
            setTimeout(() => {
                const el = document.getElementById(`step-${i}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 200);

            try {
                const prompt = initialSteps[i].prompt
                    .replace('{input}', productInput)
                    .replace('{prev}', prevResult.slice(-2000)); // Last 2000 chars of prev

                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: prompt,
                        systemPrompt: '你是电商全案策划专家团队的成员。请直接输出专业分析结果，不要寒暄或解释你的身份。用markdown格式输出，包含标题、表格、列表等结构化内容。',
                        conversationHistory: [],
                    }),
                });

                if (!res.ok) throw new Error('API请求失败');

                const reader = res.body?.getReader();
                const decoder = new TextDecoder();
                let fullText = '';

                if (reader) {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split('\n');
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6);
                                if (data === '[DONE]') continue;
                                try {
                                    const parsed = JSON.parse(data);
                                    const content = parsed.choices?.[0]?.delta?.content;
                                    if (content) {
                                        fullText += content;
                                        setSteps(prev => prev.map((s, idx) =>
                                            idx === i ? { ...s, result: fullText } : s
                                        ));
                                    }
                                } catch { /* skip parse errors */ }
                            }
                        }
                    }
                }

                prevResult = fullText;
                setSteps(prev => prev.map((s, idx) =>
                    idx === i ? { ...s, status: 'done', result: fullText } : s
                ));
            } catch (err) {
                setSteps(prev => prev.map((s, idx) =>
                    idx === i ? { ...s, status: 'error', result: `错误: ${err instanceof Error ? err.message : '未知错误'}` } : s
                ));
            }
        }

        setIsRunning(false);
        setCurrentStep(-1);
    };

    const stopPlan = () => {
        abortRef.current = true;
    };

    const completedCount = steps.filter(s => s.status === 'done').length;
    const progress = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

    return (
        <div className={styles.layout}>
            <header className={styles.header}>
                <button onClick={() => router.push('/')} className={styles.backBtn}><ArrowLeft size={16} /> 返回</button>
                <h1 className={styles.title}><Target size={20} /> 一键全案生成器</h1>
                <span className={styles.badge}>AI自动化</span>
            </header>

            <main className={styles.main}>
                {/* Input area */}
                <div className={styles.inputSection}>
                    <h2 className={styles.inputTitle}>输入你的产品信息</h2>
                    <p className={styles.inputDesc}>告诉AI你要卖什么，10分钟自动生成完整上市方案</p>
                    <textarea
                        className={styles.inputArea}
                        value={productInput}
                        onChange={e => setProductInput(e.target.value)}
                        placeholder="例如：我要在天猫卖蓝牙耳机，价格区间150-300元，主打降噪和长续航，目标人群是上班族和学生。"
                        rows={4}
                        disabled={isRunning}
                    />
                    <div className={styles.inputActions}>
                        {!isRunning ? (
                            <button className={styles.startBtn} onClick={runPlan} disabled={!productInput.trim()}>
                                <Rocket size={16} /> 开始生成全案
                            </button>
                        ) : (
                            <button className={styles.stopBtn} onClick={stopPlan}><Square size={14} /> 停止</button>
                        )}
                        <span className={styles.costHint}>预计消耗 40 积分 · 约10分钟</span>
                    </div>
                </div>

                {/* Progress */}
                {steps.length > 0 && (
                    <div className={styles.progressSection}>
                        <div className={styles.progressBar}>
                            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                        </div>
                        <div className={styles.progressInfo}>
                            <span>{completedCount}/{steps.length} 步骤完成</span>
                            <span>{progress}%</span>
                        </div>
                        <div className={styles.stepsTimeline}>
                            {steps.map((step, i) => (
                                <div key={step.id} className={`${styles.timelineItem} ${styles[step.status]}`}>
                                    <span className={styles.timelineIcon}>
                                        {step.status === 'done' ? <CheckCircle size={14} /> :
                                            step.status === 'running' ? <Loader2 size={14} className="animate-spin" /> :
                                                step.status === 'error' ? <XCircle size={14} /> : '○'}
                                    </span>
                                    <span className={styles.timelineLabel}>{step.icon} {step.title}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Results */}
                <div className={styles.results} ref={resultsRef}>
                    {steps.map((step, i) => (
                        <div key={step.id} id={`step-${i}`} className={`${styles.resultCard} ${styles[step.status]}`}>
                            <div className={styles.resultHeader}>
                                <span className={styles.resultIcon}>{step.icon}</span>
                                <h3 className={styles.resultTitle}>Step {i + 1}: {step.title}</h3>
                                <span className={styles.resultStatus}>
                                    {step.status === 'running' && <span className={styles.spinner2} />}
                                    {step.status === 'done' && <><CheckCircle size={14} /> 完成</>}
                                    {step.status === 'error' && <><XCircle size={14} /> 出错</>}
                                    {step.status === 'waiting' && '等待中'}
                                </span>
                            </div>
                            <p className={styles.resultDesc}>{step.description}</p>
                            {step.result && (
                                <div className={styles.resultContent} dangerouslySetInnerHTML={{
                                    __html: step.result
                                        .replace(/\n/g, '<br/>')
                                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                        .replace(/\|(.*)\|/g, (match) => `<code>${match}</code>`)
                                }} />
                            )}
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );
}
