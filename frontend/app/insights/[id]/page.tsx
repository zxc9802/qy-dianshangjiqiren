'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import styles from './detail.module.css';
import { api, type PageInsightInfo } from '../../lib/api';
import { formatMessage } from '../../lib/formatMessage';
import { useAuthStore } from '../../stores/auth';

function formatTime(value: string): string {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function InsightDetailPage() {
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const { isAuthenticated, isLoading, loadUser } = useAuthStore();
    const [insight, setInsight] = useState<PageInsightInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        loadUser();
    }, [loadUser]);

    useEffect(() => {
        if (isLoading) return;
        if (!isAuthenticated) {
            router.push('/login');
            return;
        }

        let cancelled = false;

        api.getInsight(params.id)
            .then((response) => {
                if (!cancelled) {
                    setInsight(response.data);
                    setError('');
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : '加载失败');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, isLoading, params.id, router]);

    if (isLoading || loading) {
        return (
            <div className={styles.loadingState}>
                <Loader2 className={styles.spinner} size={20} />
                <span>加载洞察详情中...</span>
            </div>
        );
    }

    if (error || !insight) {
        return (
            <div className={styles.loadingState}>
                <p>{error || '未找到洞察记录。'}</p>
                <Link href="/insights" className={styles.backLink}>
                    <ArrowLeft size={16} />
                    返回列表
                </Link>
            </div>
        );
    }

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <div>
                    <Link href="/insights" className={styles.backLink}>
                        <ArrowLeft size={16} />
                        返回列表
                    </Link>
                    <h1 className={styles.title}>{insight.sourceTitle || insight.pageContext.title || '网页洞察详情'}</h1>
                    <p className={styles.subtitle}>
                        由 {insight.botName} 于 {formatTime(insight.updatedAt)} 保存
                    </p>
                </div>
                <a href={insight.sourceUrl} target="_blank" rel="noreferrer" className={styles.openLink}>
                    <ExternalLink size={16} />
                    打开原网页
                </a>
            </header>

            <section className={styles.grid}>
                <article className={styles.card}>
                    <h2>摘要</h2>
                    <div
                        className={`${styles.paragraph} ${styles.richText}`}
                        dangerouslySetInnerHTML={{
                            __html: formatMessage(insight.summary || '这条记录没有单独保存摘要，可以直接查看下方对话内容。'),
                        }}
                    />
                </article>

                <article className={styles.card}>
                    <h2>页面信息</h2>
                    <dl className={styles.metaList}>
                        <div>
                            <dt>域名</dt>
                            <dd>{insight.sourceDomain || '未知'}</dd>
                        </div>
                        <div>
                            <dt>页面类型</dt>
                            <dd>{insight.pageContext.hasVideo ? '视频网页' : '普通网页'}</dd>
                        </div>
                        <div>
                            <dt>字幕来源</dt>
                            <dd>{insight.pageContext.transcriptSource}</dd>
                        </div>
                        <div>
                            <dt>原始链接</dt>
                            <dd className={styles.longValue}>{insight.sourceUrl}</dd>
                        </div>
                    </dl>
                </article>
            </section>

            <section className={styles.card}>
                <h2>网页上下文快照</h2>
                <div className={styles.snapshotGrid}>
                    <div>
                        <h3>页面简介</h3>
                        <p className={styles.paragraph}>{insight.pageContext.metaDescription || '无'}</p>
                    </div>
                    <div>
                        <h3>视频标题</h3>
                        <p className={styles.paragraph}>{insight.pageContext.videoTitle || '无'}</p>
                    </div>
                    <div>
                        <h3>视频说明</h3>
                        <p className={styles.paragraph}>{insight.pageContext.videoDescription || '无'}</p>
                    </div>
                    <div>
                        <h3>用户选中文本</h3>
                        <p className={styles.paragraph}>{insight.pageContext.selectedText || '无'}</p>
                    </div>
                    <div className={styles.fullWidth}>
                        <h3>字幕内容</h3>
                        <pre className={styles.preBlock}>{insight.pageContext.captionsText || '无'}</pre>
                    </div>
                    <div className={styles.fullWidth}>
                        <h3>页面正文摘录</h3>
                        <pre className={styles.preBlock}>{insight.pageContext.mainText || '无'}</pre>
                    </div>
                </div>
            </section>

            <section className={styles.card}>
                <h2>对话记录</h2>
                <div className={styles.messages}>
                    {insight.chatTranscript.length === 0 ? (
                        <p className={styles.paragraph}>没有保存对话内容。</p>
                    ) : (
                        insight.chatTranscript.map((message, index) => (
                            <article
                                key={`${message.role}-${index}`}
                                className={`${styles.message} ${message.role === 'user' ? styles.userMessage : styles.assistantMessage}`}
                            >
                                <div className={styles.messageRole}>
                                    {message.role === 'user' ? '用户' : '插件助手'}
                                </div>
                                {message.kind === 'image' && message.imageUrls?.length ? (
                                    <div className={styles.imageMessage}>
                                        {message.content ? (
                                            <div
                                                className={`${styles.messageContent} ${styles.richText}`}
                                                dangerouslySetInnerHTML={{ __html: formatMessage(message.content) }}
                                            />
                                        ) : null}
                                        {message.imagePrompt ? (
                                            <div className={styles.imagePrompt}>
                                                <span>绘图提示词</span>
                                                <p>{message.imagePrompt}</p>
                                            </div>
                                        ) : null}
                                        <div className={styles.imageGrid}>
                                            {message.imageUrls.map((imageUrl, imageIndex) => (
                                                <a
                                                    key={`${imageUrl}-${imageIndex}`}
                                                    href={imageUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className={styles.imageLink}
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element -- data URI previews should render directly without Next image optimization */}
                                                    <img
                                                        src={imageUrl}
                                                        alt={`generated-${imageIndex + 1}`}
                                                        className={styles.imageThumb}
                                                        loading="lazy"
                                                    />
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div
                                        className={`${styles.messageContent} ${styles.richText}`}
                                        dangerouslySetInnerHTML={{ __html: formatMessage(message.content) }}
                                    />
                                )}
                            </article>
                        ))
                    )}
                </div>
            </section>
        </main>
    );
}
