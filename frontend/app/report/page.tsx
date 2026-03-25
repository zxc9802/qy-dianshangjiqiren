'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { formatMessage } from '../lib/formatMessage';
import {
    Loader2,
    Download,
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

function renderMarkdown(md: string): string {
    return formatMessage(md, { tableClassName: 'report-table' });
}

const REPORT_EXPORT_SCALE = 2;
const REPORT_EXPORT_SLICE_HEIGHT = 3200;
const REPORT_MAX_SINGLE_IMAGE_HEIGHT = 28000;
const REPORT_MAX_PDF_SLICES = 48;
const REPORT_EXPORT_BACKGROUND = '#f8fafc';

function sanitizeDownloadName(name: string): string {
    const normalized = name
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();

    return normalized || '分析报告';
}

function waitForNextFrame(): Promise<void> {
    return new Promise((resolve) => {
        window.requestAnimationFrame(() => resolve());
    });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Canvas export failed'));
                return;
            }

            resolve(blob);
        }, 'image/png');
    });
}

function downloadBlob(blob: Blob, fileName: string) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getPdfPageOrientation(canvas: HTMLCanvasElement): 'portrait' | 'landscape' {
    return canvas.width > canvas.height ? 'landscape' : 'portrait';
}

function exportPdfFromSlices(slices: HTMLCanvasElement[], fileName: string) {
    const firstSlice = slices[0];
    const firstFormat = [firstSlice.width, firstSlice.height] as [number, number];
    const pdf = new jsPDF({
        orientation: getPdfPageOrientation(firstSlice),
        unit: 'px',
        format: firstFormat,
        compress: true,
        hotfixes: ['px_scaling'],
    });

    slices.forEach((slice, index) => {
        const format = [slice.width, slice.height] as [number, number];
        if (index > 0) {
            pdf.addPage(format, getPdfPageOrientation(slice));
        }

        pdf.addImage(slice, 'PNG', 0, 0, slice.width, slice.height, undefined, 'FAST');
    });

    downloadBlob(pdf.output('blob'), `${fileName}.pdf`);
}

async function captureReportSlices(element: HTMLDivElement): Promise<HTMLCanvasElement[]> {
    await document.fonts?.ready;

    const elementRect = element.getBoundingClientRect();
    const captureWidth = Math.ceil(elementRect.width);
    const host = document.createElement('div');
    const viewport = document.createElement('div');
    const clone = element.cloneNode(true) as HTMLDivElement;

    host.style.position = 'fixed';
    host.style.left = '-100000px';
    host.style.top = '0';
    host.style.pointerEvents = 'none';
    host.style.opacity = '0';
    host.style.zIndex = '-1';
    host.style.background = REPORT_EXPORT_BACKGROUND;

    viewport.style.width = `${captureWidth}px`;
    viewport.style.overflow = 'hidden';
    viewport.style.background = REPORT_EXPORT_BACKGROUND;

    clone.querySelectorAll('.no-print').forEach((node) => node.remove());
    clone.style.width = `${captureWidth}px`;
    clone.style.margin = '0';
    clone.style.transformOrigin = 'top left';

    viewport.appendChild(clone);
    host.appendChild(viewport);
    document.body.appendChild(host);

    try {
        await waitForNextFrame();
        const totalHeight = Math.ceil(clone.scrollHeight);
        const slices: HTMLCanvasElement[] = [];

        for (let offset = 0; offset < totalHeight; offset += REPORT_EXPORT_SLICE_HEIGHT) {
            const sliceHeight = Math.min(REPORT_EXPORT_SLICE_HEIGHT, totalHeight - offset);
            viewport.style.height = `${sliceHeight}px`;
            clone.style.transform = `translateY(-${offset}px)`;

            await waitForNextFrame();

            const sliceCanvas = await html2canvas(viewport, {
                scale: REPORT_EXPORT_SCALE,
                useCORS: true,
                backgroundColor: REPORT_EXPORT_BACKGROUND,
                width: captureWidth,
                height: sliceHeight,
                windowWidth: captureWidth,
                windowHeight: sliceHeight,
                scrollX: 0,
                scrollY: 0,
            });

            slices.push(sliceCanvas);
        }

        return slices;
    } finally {
        host.remove();
    }
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
            const baseName = sanitizeDownloadName(report?.title || '分析报告');
            const slices = await captureReportSlices(pageRef.current);
            if (!slices.length) {
                throw new Error('No exportable content');
            }

            const totalCanvasHeight = slices.reduce((sum, canvas) => sum + canvas.height, 0);
            if (totalCanvasHeight <= REPORT_MAX_SINGLE_IMAGE_HEIGHT) {
                const mergedCanvas = document.createElement('canvas');
                mergedCanvas.width = slices[0].width;
                mergedCanvas.height = totalCanvasHeight;

                const context = mergedCanvas.getContext('2d');
                if (!context) {
                    throw new Error('Canvas context unavailable');
                }

                let offsetY = 0;
                for (const slice of slices) {
                    context.drawImage(slice, 0, offsetY);
                    offsetY += slice.height;
                }

                const mergedBlob = await canvasToBlob(mergedCanvas);
                downloadBlob(mergedBlob, `${baseName}.png`);
                return;
            }

            if (slices.length <= REPORT_MAX_PDF_SLICES) {
                exportPdfFromSlices(slices, baseName);
                alert('报告较长，已自动导出为 PDF。');
                return;
            }

            const zip = new JSZip();
            for (const [index, slice] of slices.entries()) {
                const blob = await canvasToBlob(slice);
                const fileIndex = String(index + 1).padStart(2, '0');
                zip.file(`${baseName}-${fileIndex}.png`, blob);
            }

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(zipBlob, `${baseName}-长图分片.zip`);
            alert('报告过长，已自动拆分为多张图片打包下载。');
        } catch (error) {
            console.error('[Report] save image failed', error);
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
                    {saving ? <><Loader2 size={14} className="animate-spin" /> 导出中...</> : <><Download size={14} /> 下载报告</>}
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
