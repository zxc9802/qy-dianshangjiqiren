'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import html2canvas from 'html2canvas';
import {
    Loader2,
    Camera,
    Calendar,
    Bot,
    MessageSquare,
    Target,
    CheckCircle,
    ClipboardList,
    User,
} from 'lucide-react';

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

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderMarkdown(md: string): string {
    const safeLineBreakToken = '__SAFE_LINE_BREAK__';
    const html = escapeHtml(md.replace(/<br\s*\/?>/gi, safeLineBreakToken))
        .replace(new RegExp(safeLineBreakToken, 'g'), '<br>')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^[\*\-]\s+/gm, '• ');

    const lines = html.split('\n');
    let inTable = false;
    const parts: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('|') && trimmed.includes('|')) {
            const cells = trimmed.split('|').filter(Boolean).map((cell) => cell.trim());
            if (cells.every((cell) => /^[-:]+$/.test(cell))) {
                continue;
            }
            if (!inTable) {
                parts.push('<table class="report-table">');
                inTable = true;
            }
            parts.push(`<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`);
            continue;
        }

        if (inTable) {
            parts.push('</table>');
            inTable = false;
        }

        if (trimmed) {
            parts.push(`<p>${line}</p>`);
        }
    }

    if (inTable) {
        parts.push('</table>');
    }

    return parts.join('');
}

export default function ReportPage() {
    const router = useRouter();
    const pageRef = useRef<HTMLDivElement>(null);
    const [report, setReport] = useState<ReportData | null>(null);
    const [chatOpen, setChatOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const raw = localStorage.getItem('__report_data__');
        if (raw) {
            try {
                setReport(JSON.parse(raw));
            } catch {
                // ignore broken local cache
            }
        }
        setLoading(false);
    }, []);

    const dateStr = useMemo(() => {
        if (!report?.generatedAt) return '';
        const generatedAt = new Date(report.generatedAt);
        return `${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, '0')}-${String(generatedAt.getDate()).padStart(2, '0')} ${String(generatedAt.getHours()).padStart(2, '0')}:${String(generatedAt.getMinutes()).padStart(2, '0')}`;
    }, [report?.generatedAt]);

    const priorityColors: Record<string, { bg: string; text: string; label: string }> = {
        high: { bg: '#fef2f2', text: '#dc2626', label: '高优先级' },
        medium: { bg: '#fffbeb', text: '#d97706', label: '中优先级' },
        low: { bg: '#f0fdf4', text: '#16a34a', label: '低优先级' },
    };

    const timelineColors: Record<string, { bg: string; text: string }> = {
        立即执行: { bg: '#dbeafe', text: '#2563eb' },
        本周执行: { bg: '#fef9c3', text: '#a16207' },
        本月执行: { bg: '#fce7f3', text: '#be185d' },
    };

    const handleClose = () => {
        if (window.history.length > 1) {
            router.back();
            return;
        }
        router.push('/');
    };

    const saveAsImage = async () => {
        if (!pageRef.current) return;
        setSaving(true);
        try {
            const canvas = await html2canvas(pageRef.current, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#f8fafc',
                windowWidth: 1280,
            });
            const link = document.createElement('a');
            link.download = `${report?.title || '分析报告'}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch {
            alert('保存报告图片失败，请重试');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, color: '#64748b' }}>
                <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <p>报告加载中...</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    if (!report) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b' }}>
                <p>报告数据加载失败，请回到聊天页重新生成。</p>
            </div>
        );
    }

    return (
        <div
            ref={pageRef}
            style={{
                minHeight: '100vh',
                background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f1f5f9 100%)',
                color: '#1e293b',
                fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
            }}
        >
            <div
                className="no-print"
                style={{ position: 'fixed', top: 20, right: 20, zIndex: 100, display: 'flex', gap: 8 }}
            >
                <button
                    onClick={saveAsImage}
                    disabled={saving}
                    style={{
                        padding: '10px 20px',
                        borderRadius: 10,
                        border: 'none',
                        cursor: 'pointer',
                        background: '#3b82f6',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: 14,
                        boxShadow: '0 4px 12px rgba(59,130,246,0.3)',
                        opacity: saving ? 0.7 : 1,
                    }}
                >
                    {saving ? <><Loader2 size={14} className="animate-spin" /> 保存中...</> : <><Camera size={14} /> 保存图片</>}
                </button>
                <button
                    onClick={handleClose}
                    style={{
                        padding: '10px 20px',
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        cursor: 'pointer',
                        background: '#fff',
                        color: '#64748b',
                        fontWeight: 500,
                        fontSize: 14,
                    }}
                >
                    返回
                </button>
            </div>

            <header
                style={{
                    background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 50%, #3b82f6 100%)',
                    color: '#fff',
                    padding: '60px 40px 50px',
                    position: 'relative',
                    overflow: 'hidden',
                }}
            >
                <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
                <div style={{ position: 'absolute', bottom: -40, left: '30%', width: 300, height: 300, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
                <div style={{ maxWidth: 900, margin: '0 auto', position: 'relative' }}>
                    <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12, letterSpacing: 2 }}>AI 对话分析报告</div>
                    <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 16, lineHeight: 1.3 }}>{report.title}</h1>
                    <p style={{ fontSize: 16, opacity: 0.85, lineHeight: 1.7, maxWidth: 700 }}>{report.summary}</p>
                    <div style={{ display: 'flex', gap: 24, marginTop: 28, fontSize: 13, opacity: 0.7, flexWrap: 'wrap' }}>
                        <span><Calendar size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> {dateStr}</span>
                        <span><Bot size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> {report.botName}</span>
                        <span><MessageSquare size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> {report.messageCount} 条消息</span>
                    </div>
                    {report.tags?.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                            {report.tags.map((tag, index) => (
                                <span
                                    key={`${tag}-${index}`}
                                    style={{
                                        padding: '4px 12px',
                                        borderRadius: 20,
                                        background: 'rgba(255,255,255,0.15)',
                                        fontSize: 12,
                                        backdropFilter: 'blur(4px)',
                                    }}
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </header>

            <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 20px 80px' }}>
                <div
                    style={{
                        marginBottom: 20,
                        padding: '12px 16px',
                        borderRadius: 12,
                        background: '#fff7ed',
                        border: '1px solid #fdba74',
                        color: '#9a3412',
                        fontSize: 13,
                        lineHeight: 1.7,
                    }}
                >
                    当前报告暂存在本地浏览器中。刷新页面、清理浏览器数据或更换设备后，这份报告可能无法恢复。
                </div>

                <section style={{ marginBottom: 40 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 24 }}><Target size={24} /></span>
                        关键洞察
                    </h2>
                    <div style={{ display: 'grid', gap: 12 }}>
                        {report.insights.map((item, index) => {
                            const priority = priorityColors[item.priority] || priorityColors.medium;
                            return (
                                <div key={`${item.title}-${index}`} style={{ background: '#fff', borderRadius: 14, padding: '20px 24px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                                    <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: priority.bg, color: priority.text, whiteSpace: 'nowrap', marginTop: 2 }}>
                                        {priority.label}
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

                <section style={{ marginBottom: 40 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 24 }}><CheckCircle size={24} /></span>
                        行动建议
                    </h2>
                    <div style={{ display: 'grid', gap: 12 }}>
                        {report.actions.map((item, index) => {
                            const timeline = timelineColors[item.timeline] || timelineColors['本周执行'];
                            return (
                                <div key={`${item.title}-${index}`} style={{ background: '#fff', borderRadius: 14, padding: '20px 24px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                        <span style={{ fontWeight: 700, fontSize: 18, color: '#3b82f6' }}>{index + 1}</span>
                                        <span style={{ fontWeight: 600, fontSize: 15 }}>{item.title}</span>
                                        <span style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: timeline.bg, color: timeline.text }}>
                                            {item.timeline}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, marginBottom: 6 }}>{item.content}</div>
                                    {item.impact && <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 500 }}>预期影响：{item.impact}</div>}
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section style={{ marginBottom: 40 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 24 }}><ClipboardList size={24} /></span>
                        整体方案摘要
                    </h2>
                    <div
                        style={{
                            background: '#fff',
                            borderRadius: 14,
                            padding: '24px 28px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                            fontSize: 14,
                            lineHeight: 1.8,
                            color: '#334155',
                        }}
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(report.planSummary || '') }}
                    />
                </section>

                <section style={{ marginBottom: 40 }}>
                    <h2
                        onClick={() => setChatOpen((current) => !current)}
                        style={{
                            fontSize: 20,
                            fontWeight: 700,
                            marginBottom: 20,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            cursor: 'pointer',
                            userSelect: 'none',
                        }}
                    >
                        <span style={{ fontSize: 24 }}><MessageSquare size={24} /></span>
                        对话记录
                        <span style={{ marginLeft: 'auto', fontSize: 14, color: '#94a3b8', transition: 'transform 0.3s ease', transform: chatOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>⌄</span>
                    </h2>
                    <div style={{ maxHeight: chatOpen ? '100000px' : '0', overflow: 'hidden', transition: chatOpen ? 'max-height 0.5s ease-in' : 'max-height 0.3s ease-out' }}>
                        <div style={{ background: '#fff', borderRadius: 14, padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                            {report.chatHistory.filter((message) => message.content?.trim()).map((message, index) => (
                                <div key={`${message.role}-${index}`} style={{ display: 'flex', gap: 12, marginBottom: 16, flexDirection: message.role === 'user' ? 'row-reverse' : 'row' }}>
                                    <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: message.role === 'user' ? '#dbeafe' : '#f1f5f9', color: message.role === 'user' ? '#2563eb' : '#64748b' }}>
                                        {message.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                                    </div>
                                    <div style={{ maxWidth: '80%', padding: '10px 16px', borderRadius: 12, fontSize: 13, lineHeight: 1.7, wordBreak: 'break-word', background: message.role === 'user' ? '#eff6ff' : '#f8fafc', border: `1px solid ${message.role === 'user' ? '#bfdbfe' : '#e2e8f0'}` }} dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <footer style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
                    <p>由 {report.botName} 生成，时间：{dateStr}</p>
                    <p style={{ marginTop: 4 }}>内容由 AI 生成，请结合实际业务再确认。</p>
                </footer>
            </main>

            <style>{`
                @media print {
                    .no-print { display: none !important; }
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
                .report-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 12px 0;
                    font-size: 13px;
                }
                .report-table td {
                    border: 1px solid #e2e8f0;
                    padding: 8px 12px;
                    vertical-align: top;
                }
                .report-table tr:first-child td {
                    font-weight: 600;
                    background: #f8fafc;
                }
            `}</style>
        </div>
    );
}
