'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './workflow.module.css';

interface WorkflowTemplate {
    id: string;
    name: string;
    description: string;
    steps: { botId: string; botName: string; instruction: string }[];
}

const TEMPLATES: WorkflowTemplate[] = [
    {
        id: 'wf-1',
        name: '新品上架全流程',
        description: '从卖点提炼→主图策划→评价模板，一次搞定新品上架物料',
        steps: [
            { botId: '9', botName: '卖点教练', instruction: '提炼产品核心卖点' },
            { botId: '10', botName: '天猫主图策划教练', instruction: '根据卖点策划5张主图' },
            { botId: '12', botName: '天猫评价教练', instruction: '根据卖点设计评价模板' },
        ],
    },
    {
        id: 'wf-2',
        name: '竞品全面分析',
        description: '竞争分析→趋势拆解→定价策略，知己知彼制定对策',
        steps: [
            { botId: '13', botName: '天猫竞争策略教练', instruction: '分析竞品优劣势' },
            { botId: '8', botName: '天猫爆款趋势拆解', instruction: '分析品类趋势和机会' },
            { botId: '14', botName: '天猫客单价提升教练', instruction: '制定定价和提升策略' },
        ],
    },
    {
        id: 'wf-3',
        name: '小红书内容矩阵',
        description: '爆文拆解→标题优化→正文写作→评论引导',
        steps: [
            { botId: '17', botName: '小红书爆文拆解复制', instruction: '拆解竞品爆文公式' },
            { botId: '18', botName: '小红书爆款标题', instruction: '给出10个高点击标题' },
            { botId: '21', botName: '小红书正文拆解SOP', instruction: '按公式写正文' },
            { botId: '22', botName: '小红书笔记评论生成', instruction: '生成引导评论' },
        ],
    },
    {
        id: 'wf-4',
        name: 'AI落地全流程',
        description: '场景挖掘→需求细化→提示词调试，把AI真正用起来',
        steps: [
            { botId: '32', botName: '调研访谈—高价值场景', instruction: '挖掘高价值AI场景' },
            { botId: '31', botName: 'AI工作流开发需求细化', instruction: '输出需求文档' },
            { botId: '33', botName: '火火提示词调试', instruction: '调试优化提示词' },
        ],
    },
];

interface StepResult {
    botName: string;
    content: string;
    status: 'pending' | 'running' | 'done' | 'error';
}

export default function WorkflowPage() {
    const router = useRouter();
    const [selectedWf, setSelectedWf] = useState<WorkflowTemplate | null>(null);
    const [userInput, setUserInput] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [results, setResults] = useState<StepResult[]>([]);
    const [currentStep, setCurrentStep] = useState(-1);

    const runWorkflow = async () => {
        if (!selectedWf || !userInput.trim()) return;

        setIsRunning(true);
        const stepResults: StepResult[] = selectedWf.steps.map(s => ({
            botName: s.botName,
            content: '',
            status: 'pending' as const,
        }));
        setResults(stepResults);

        let prevOutput = userInput.trim();

        for (let i = 0; i < selectedWf.steps.length; i++) {
            setCurrentStep(i);
            stepResults[i].status = 'running';
            setResults([...stepResults]);

            const step = selectedWf.steps[i];
            const prompt = `${step.instruction}\n\n用户输入/上一步结果:\n${prevOutput}`;

            try {
                const BOT_PROMPTS: Record<string, string> = {
                    '8': '你是天猫爆款趋势分析专家',
                    '9': '你是卖点提炼专家',
                    '10': '你是天猫主图策划专家',
                    '12': '你是天猫评价内容策划专家',
                    '13': '你是天猫竞争策略专家',
                    '14': '你是天猫客单价提升专家',
                    '17': '你是小红书爆文拆解专家',
                    '18': '你是小红书爆款标题专家',
                    '21': '你是小红书正文拆解专家',
                    '22': '你是小红书评论生成专家',
                    '31': '你是AI需求分析师',
                    '32': '你是AI场景挖掘专家',
                    '33': '你是AI提示词调试专家',
                };

                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        botId: step.botId,
                        systemPrompt: BOT_PROMPTS[step.botId] || '你是一个AI助手',
                        messages: [
                            { role: 'user', content: prompt },
                        ],
                    }),
                });

                if (!res.ok) throw new Error('API error');

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
                                stepResults[i].content = fullText;
                                setResults([...stepResults]);
                            }
                        } catch { /* ignore */ }
                    }
                }

                // Remove suggestions JSON
                const cleaned = fullText.replace(/```json[\s\S]*?```/g, '').trim();
                stepResults[i].content = cleaned;
                stepResults[i].status = 'done';
                prevOutput = cleaned;
            } catch {
                stepResults[i].status = 'error';
                stepResults[i].content = '执行失败';
            }

            setResults([...stepResults]);
        }

        setCurrentStep(-1);
        setIsRunning(false);
    };

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <button className={styles.backBtn} onClick={() => router.push('/')}>
                    ← 返回
                </button>
                <h1 className={styles.title}>工作流</h1>
                <div className={styles.headerRight} />
            </header>

            <div className={styles.content}>
                {!selectedWf ? (
                    <div className={styles.templateList}>
                        <p className={styles.subtitle}>选择一个工作流模板，一键串联多个AI智能体</p>
                        <div className={styles.grid}>
                            {TEMPLATES.map(wf => (
                                <div
                                    key={wf.id}
                                    className={styles.templateCard}
                                    onClick={() => setSelectedWf(wf)}
                                >
                                    <h3 className={styles.templateName}>{wf.name}</h3>
                                    <p className={styles.templateDesc}>{wf.description}</p>
                                    <div className={styles.stepChain}>
                                        {wf.steps.map((s, i) => (
                                            <span key={i} className={styles.stepTag}>
                                                {s.botName}
                                                {i < wf.steps.length - 1 && <span className={styles.arrow}>→</span>}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className={styles.executor}>
                        <div className={styles.wfHeader}>
                            <button className={styles.backLink} onClick={() => { setSelectedWf(null); setResults([]); setUserInput(''); }}>
                                ← 返回模板列表
                            </button>
                            <h2 className={styles.wfTitle}>{selectedWf.name}</h2>
                            <p className={styles.wfDesc}>{selectedWf.description}</p>
                        </div>

                        <div className={styles.inputSection}>
                            <label className={styles.inputLabel}>输入你的产品/需求信息</label>
                            <textarea
                                className={styles.wfInput}
                                rows={3}
                                value={userInput}
                                onChange={e => setUserInput(e.target.value)}
                                placeholder="例如：我是做竹纤维毛巾的，客单价39元，目标人群25-40岁女性..."
                                disabled={isRunning}
                            />
                            <button
                                className={styles.runBtn}
                                onClick={runWorkflow}
                                disabled={isRunning || !userInput.trim()}
                            >
                                {isRunning ? `执行中 (${currentStep + 1}/${selectedWf.steps.length})...` : '一键执行'}
                            </button>
                        </div>

                        {results.length > 0 && (
                            <div className={styles.results}>
                                {results.map((r, i) => (
                                    <div key={i} className={`${styles.resultCard} ${styles[r.status]}`}>
                                        <div className={styles.resultHeader}>
                                            <span className={styles.stepNumber}>步骤 {i + 1}</span>
                                            <span className={styles.resultBot}>{r.botName}</span>
                                            <span className={styles.statusBadge}>
                                                {r.status === 'pending' && '等待中'}
                                                {r.status === 'running' && '执行中...'}
                                                {r.status === 'done' && '✓ 完成'}
                                                {r.status === 'error' && '✕ 失败'}
                                            </span>
                                        </div>
                                        {r.content && (
                                            <div className={styles.resultContent}>
                                                <pre className={styles.resultText}>{r.content}</pre>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
