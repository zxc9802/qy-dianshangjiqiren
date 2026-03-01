'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/auth';
import styles from './list.module.css';

interface WorkflowItem {
    id: string;
    name: string;
    description: string;
    triggerType: string;
    isPreset: boolean;
    usageCount: number;
    updatedAt: string;
    userId: string;
    templateParams?: string;
}

interface Recommendation {
    name: string;
    description: string;
    suggestedPrompt: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const PRESET_TEMPLATES = [
    { icon: '📈', name: '爆款打造流水线', desc: '热点→卖点→主图→评价，一站式爆款内容', gradient: 'linear-gradient(135deg, #2563eb, #60a5fa)' },
    { icon: '📕', name: '小红书内容矩阵', desc: '选题→标题→正文→评论，批量内容生产', gradient: 'linear-gradient(135deg, #dc2626, #f87171)' },
    { icon: '⚔️', name: '竞品分析报告', desc: '竞品拆解→策略分析→行动建议', gradient: 'linear-gradient(135deg, #7c3aed, #a78bfa)' },
    { icon: '🌍', name: '跨境选品报告', desc: '市场分析→商业建议→多语翻译', gradient: 'linear-gradient(135deg, #059669, #34d399)' },
    { icon: '🧪', name: 'AI 提示词优化', desc: '提示词调试→效果评估→迭代优化', gradient: 'linear-gradient(135deg, #ea580c, #fb923c)' },
];

function getToken(): string | null {
    return typeof window !== 'undefined' ? localStorage.getItem('token') : null;
}

export default function WorkflowListPage() {
    const router = useRouter();
    const { user, isAuthenticated, isLoading, loadUser } = useAuthStore();
    const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
    const [loading, setLoading] = useState(true);

    // AI builder state
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
    const [showRecs, setShowRecs] = useState(false);

    useEffect(() => { loadUser(); }, [loadUser]);

    useEffect(() => {
        if (!isAuthenticated || isLoading) return;
        const token = getToken();
        fetch(`${API_BASE}/workflows`, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        })
            .then(r => r.json())
            .then(data => { if (data.success) setWorkflows(data.data); })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [isAuthenticated, isLoading]);

    const handleDelete = async (id: string) => {
        if (!confirm('确定删除？')) return;
        const token = getToken();
        await fetch(`${API_BASE}/workflows/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        setWorkflows(w => w.filter(wf => wf.id !== id));
    };

    // AI auto-build
    const handleAiBuild = async () => {
        if (!aiPrompt.trim() || aiLoading) return;
        setAiLoading(true);
        setRecommendations([]);
        try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/workflow-ai/generate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: aiPrompt }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);

            // Show recommendations if any
            if (data.data.recommendations?.length > 0) {
                setRecommendations(data.data.recommendations);
                setShowRecs(true);
            }

            // Navigate to the generated workflow
            router.push(`/workflow-builder/${data.data.workflow.id}`);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'AI 生成失败，请重试');
        } finally {
            setAiLoading(false);
        }
    };

    const handleAiKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAiBuild();
        }
    };

    if (isLoading) return <div className={styles.loading}><div className={styles.spinner} /></div>;
    if (!isAuthenticated) { router.push('/login'); return null; }

    const myWorkflows = workflows.filter(w => !w.isPreset);

    return (
        <div className={styles.layout}>
            <header className={styles.header}>
                <button onClick={() => router.push('/')} className={styles.backBtn}>← 返回首页</button>
                <h1 className={styles.title}>⚡ 工作流编排器</h1>
                <button className={styles.createBtn} onClick={() => router.push('/workflow-builder/new')}>
                    + 空白画布
                </button>
            </header>

            <main className={styles.main}>
                {/* AI Builder */}
                <section className={styles.aiSection}>
                    <div className={styles.aiBox}>
                        <div className={styles.aiIcon}>🤖</div>
                        <div className={styles.aiContent}>
                            <h2 className={styles.aiTitle}>告诉 AI 你想自动化什么</h2>
                            <p className={styles.aiHint}>AI 会帮你选择合适的智能体并自动搭建工作流，还会推荐创建新智能体来补强效果</p>
                            <div className={styles.aiInputRow}>
                                <input
                                    className={styles.aiInput}
                                    value={aiPrompt}
                                    onChange={e => setAiPrompt(e.target.value)}
                                    onKeyDown={handleAiKeyDown}
                                    placeholder="例：每天分析微博热点，提炼卖点，生成小红书爆款标题和正文"
                                    disabled={aiLoading}
                                />
                                <button
                                    className={styles.aiBtn}
                                    onClick={handleAiBuild}
                                    disabled={!aiPrompt.trim() || aiLoading}
                                >
                                    {aiLoading ? '⏳ 生成中...' : '✨ 一键生成'}
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Recommendations Modal */}
                {showRecs && recommendations.length > 0 && (
                    <div className={styles.recsOverlay} onClick={() => setShowRecs(false)}>
                        <div className={styles.recsModal} onClick={e => e.stopPropagation()}>
                            <h3 className={styles.recsTitle}>💡 AI 建议创建以下智能体</h3>
                            <p className={styles.recsSubtitle}>为了让这个工作流效果更好，建议补充这些智能体：</p>
                            {recommendations.map((rec, i) => (
                                <div key={i} className={styles.recCard}>
                                    <h4>{rec.name}</h4>
                                    <p>{rec.description}</p>
                                    <div className={styles.recPrompt}>
                                        <strong>建议提示词：</strong>
                                        <pre>{rec.suggestedPrompt}</pre>
                                    </div>
                                </div>
                            ))}
                            <button className={styles.recsClose} onClick={() => setShowRecs(false)}>
                                了解了，先查看工作流
                            </button>
                        </div>
                    </div>
                )}

                {/* Preset Templates */}
                <section>
                    <h2 className={styles.sectionTitle}>🔥 推荐工作流模板</h2>
                    <div className={styles.templateGrid}>
                        {PRESET_TEMPLATES.map((tpl, i) => (
                            <div
                                key={i}
                                className={styles.templateCard}
                                style={{ background: tpl.gradient }}
                                onClick={() => {
                                    setAiPrompt(tpl.desc);
                                    handleAiBuild();
                                }}
                            >
                                <span className={styles.templateIcon}>{tpl.icon}</span>
                                <h3 className={styles.templateName}>{tpl.name}</h3>
                                <p className={styles.templateDesc}>{tpl.desc}</p>
                                <span className={styles.templateAction}>一键使用 →</span>
                            </div>
                        ))}
                    </div>
                </section>

                {/* My Workflows */}
                <section>
                    <h2 className={styles.sectionTitle}>📂 我的工作流</h2>
                    {loading ? (
                        <p className={styles.empty}>加载中...</p>
                    ) : myWorkflows.length === 0 ? (
                        <div className={styles.emptyState}>
                            <p>还没有自定义工作流</p>
                            <p className={styles.emptyHint}>用上方 AI 输入框创建，或从模板开始</p>
                        </div>
                    ) : (
                        <div className={styles.grid}>
                            {myWorkflows.map(wf => (
                                <div
                                    key={wf.id}
                                    className={styles.card}
                                    onClick={() => router.push(`/workflow-builder/${wf.id}`)}
                                >
                                    <h3 className={styles.cardTitle}>{wf.name}</h3>
                                    <p className={styles.cardDesc}>{wf.description || '无描述'}</p>
                                    <div className={styles.cardMeta}>
                                        <span>🔄 {wf.usageCount} 次运行</span>
                                        <span>
                                            {wf.triggerType === 'cron' ? '⏰ 定时' :
                                                wf.triggerType === 'webhook' ? '🔗 Webhook' : '👆 手动'}
                                        </span>
                                    </div>
                                    <button
                                        className={styles.cardDelete}
                                        onClick={e => { e.stopPropagation(); handleDelete(wf.id); }}
                                    >
                                        🗑️
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}
