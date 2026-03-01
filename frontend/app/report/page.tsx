'use client';

import { useEffect, useState } from 'react';

interface ReportData {
    title: string;
    summary: string;
    insights: { title: string; content: string; priority: string }[];
    actions: { title: string; content: string; timeline: string; impact: string }[];
    planSummary: string;
    tags: string[];
    botId: string;
    botName: string;
    generatedAt: string;
    messageCount: number;
    chatHistory: { role: string; content: string }[];
}

export default function ReportPage() {
    const [report, setReport] = useState<ReportData | null>(null);

    useEffect(() => {
        const raw = localStorage.getItem('__report_data__');
        if (raw) {
            try {
                setReport(JSON.parse(raw));
            } catch { /* ignore */ }
        }
    }, []);

    if (!report) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui', color: '#64748b' }}>
                <p>报告数据加载失败，请从聊天页面重新生成。</p>
            </div>
        );
    }

    const genDate = new Date(report.generatedAt);
    const dateStr = `${genDate.getFullYear()}年${genDate.getMonth() + 1}月${genDate.getDate()}日 ${genDate.getHours().toString().padStart(2, '0')}:${genDate.getMinutes().toString().padStart(2, '0')}`;

    const priorityColors: Record<string, { bg: string; text: string; label: string }> = {
        high: { bg: '#fef2f2', text: '#dc2626', label: '高' },
        medium: { bg: '#fffbeb', text: '#d97706', label: '中' },
        low: { bg: '#f0fdf4', text: '#16a34a', label: '低' },
    };

    const timelineColors: Record<string, { bg: string; text: string }> = {
        '短期': { bg: '#dbeafe', text: '#2563eb' },
        '中期': { bg: '#fef9c3', text: '#a16207' },
        '长期': { bg: '#fce7f3', text: '#be185d' },
    };

    function renderMarkdown(md: string): string {
        let html = md
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/^#{1,6}\s*/gm, '')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/^[\*\-]\s+/gm, '• ');

        // Tables
        const lines = html.split('\n');
        let inTable = false;
        const parts: string[] = [];
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('|') && t.includes('|')) {
                const cells = t.split('|').filter(c => c.trim()).map(c => c.trim());
                if (cells.every(c => /^[-:]+$/.test(c))) continue;
                if (!inTable) { parts.push('<table class="report-table">'); inTable = true; }
                parts.push('<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>');
            } else {
                if (inTable) { parts.push('</table>'); inTable = false; }
                if (t) parts.push(`<p>${line}</p>`);
            }
        }
        if (inTable) parts.push('</table>');
        return parts.join('');
    }

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f1f5f9 100%)',
            fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
            color: '#1e293b',
        }}>
            {/* Print button fixed */}
            <div style={{
                position: 'fixed', top: 20, right: 20, zIndex: 100,
                display: 'flex', gap: 8,
            }} className="no-print">
                <button onClick={() => window.print()} style={{
                    padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: '#3b82f6', color: '#fff', fontWeight: 600, fontSize: 14,
                    boxShadow: '0 4px 12px rgba(59,130,246,0.3)',
                }}>
                    🖨️ 打印 / 下载PDF
                </button>
                <button onClick={() => window.close()} style={{
                    padding: '10px 20px', borderRadius: 10, border: '1px solid #cbd5e1', cursor: 'pointer',
                    background: '#fff', color: '#64748b', fontWeight: 500, fontSize: 14,
                }}>
                    关闭
                </button>
            </div>

            {/* Cover Section */}
            <header style={{
                background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 50%, #3b82f6 100%)',
                color: '#fff',
                padding: '60px 40px 50px',
                position: 'relative',
                overflow: 'hidden',
            }}>
                <div style={{
                    position: 'absolute', top: -60, right: -60, width: 200, height: 200,
                    borderRadius: '50%', background: 'rgba(255,255,255,0.06)',
                }} />
                <div style={{
                    position: 'absolute', bottom: -40, left: '30%', width: 300, height: 300,
                    borderRadius: '50%', background: 'rgba(255,255,255,0.04)',
                }} />
                <div style={{ maxWidth: 900, margin: '0 auto', position: 'relative' }}>
                    <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12, letterSpacing: 2 }}>
                        AI 智能分析报告
                    </div>
                    <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 16, lineHeight: 1.3 }}>
                        {report.title}
                    </h1>
                    <p style={{ fontSize: 16, opacity: 0.85, lineHeight: 1.7, maxWidth: 700 }}>
                        {report.summary}
                    </p>
                    <div style={{ display: 'flex', gap: 24, marginTop: 28, fontSize: 13, opacity: 0.7 }}>
                        <span>📅 {dateStr}</span>
                        <span>🤖 {report.botName}</span>
                        <span>💬 {report.messageCount} 条消息</span>
                    </div>
                    {report.tags && report.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                            {report.tags.map((tag, i) => (
                                <span key={i} style={{
                                    padding: '4px 12px', borderRadius: 20,
                                    background: 'rgba(255,255,255,0.15)', fontSize: 12,
                                    backdropFilter: 'blur(4px)',
                                }}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </header>

            {/* Content */}
            <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 20px 80px' }}>

                {/* Key Insights */}
                <section style={{ marginBottom: 40 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 24 }}>🎯</span> 关键洞察
                    </h2>
                    <div style={{ display: 'grid', gap: 12 }}>
                        {report.insights.map((item, i) => {
                            const p = priorityColors[item.priority] || priorityColors.medium;
                            return (
                                <div key={i} style={{
                                    background: '#fff', borderRadius: 14, padding: '20px 24px',
                                    border: '1px solid #e2e8f0',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                    display: 'flex', gap: 16, alignItems: 'flex-start',
                                }}>
                                    <span style={{
                                        padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                                        background: p.bg, color: p.text, whiteSpace: 'nowrap', marginTop: 2,
                                    }}>
                                        {p.label}
                                    </span>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{item.title}</div>
                                        <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7 }}>{item.content}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Action Items */}
                <section style={{ marginBottom: 40 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 24 }}>✅</span> 行动建议
                    </h2>
                    <div style={{ display: 'grid', gap: 12 }}>
                        {report.actions.map((item, i) => {
                            const tc = timelineColors[item.timeline] || timelineColors['中期'];
                            return (
                                <div key={i} style={{
                                    background: '#fff', borderRadius: 14, padding: '20px 24px',
                                    border: '1px solid #e2e8f0',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                        <span style={{ fontWeight: 700, fontSize: 18, color: '#3b82f6' }}>{i + 1}</span>
                                        <span style={{ fontWeight: 600, fontSize: 15 }}>{item.title}</span>
                                        <span style={{
                                            marginLeft: 'auto', padding: '3px 10px', borderRadius: 6, fontSize: 12,
                                            fontWeight: 500, background: tc.bg, color: tc.text,
                                        }}>
                                            {item.timeline}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, marginBottom: 6 }}>{item.content}</div>
                                    {item.impact && (
                                        <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 500 }}>
                                            → 预期效果：{item.impact}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Plan Summary */}
                <section style={{ marginBottom: 40 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 24 }}>📋</span> 方案汇总
                    </h2>
                    <div style={{
                        background: '#fff', borderRadius: 14, padding: '24px 28px',
                        border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                        fontSize: 14, lineHeight: 1.8, color: '#334155',
                    }} dangerouslySetInnerHTML={{ __html: renderMarkdown(report.planSummary || '') }} />
                </section>

                {/* Chat History */}
                <section style={{ marginBottom: 40 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 24 }}>💬</span> 原始对话记录
                    </h2>
                    <div style={{
                        background: '#fff', borderRadius: 14, padding: '24px',
                        border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}>
                        {report.chatHistory.filter(m => m.content?.trim()).map((msg, i) => (
                            <div key={i} style={{
                                display: 'flex', gap: 12, marginBottom: 16,
                                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                            }}>
                                <div style={{
                                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 14,
                                    background: msg.role === 'user' ? '#dbeafe' : '#f1f5f9',
                                    color: msg.role === 'user' ? '#2563eb' : '#64748b',
                                }}>
                                    {msg.role === 'user' ? '👤' : '🤖'}
                                </div>
                                <div style={{
                                    maxWidth: '80%', padding: '10px 16px', borderRadius: 12,
                                    fontSize: 13, lineHeight: 1.7, wordBreak: 'break-word',
                                    background: msg.role === 'user' ? '#eff6ff' : '#f8fafc',
                                    border: `1px solid ${msg.role === 'user' ? '#bfdbfe' : '#e2e8f0'}`,
                                }} dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                            </div>
                        ))}
                    </div>
                </section>

                {/* Footer */}
                <footer style={{
                    textAlign: 'center', fontSize: 12, color: '#94a3b8',
                    paddingTop: 20, borderTop: '1px solid #e2e8f0',
                }}>
                    <p>由 {report.botName} 智能分析生成 · {dateStr}</p>
                    <p style={{ marginTop: 4 }}>电商聚合机器人 AI平台</p>
                </footer>
            </main>

            {/* Print styles */}
            <style>{`
                @media print {
                    .no-print { display: none !important; }
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
                .report-table {
                    width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px;
                }
                .report-table td {
                    border: 1px solid #e2e8f0; padding: 8px 12px; vertical-align: top;
                }
                .report-table tr:first-child td {
                    font-weight: 600; background: #f8fafc;
                }
            `}</style>
        </div>
    );
}
