'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    Clock3,
    ExternalLink,
    History,
    House,
    Loader2,
    Menu,
    RefreshCcw,
    Trash2,
    Video,
} from 'lucide-react';
import { api, ApiError, type VideoGenerationHistoryItem } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import styles from './VideoWorkbenchClient.module.css';

const WORKBENCH_ROUTE = '/bot/video-workbench';
const VIDEO_WORKBENCH_EXTERNAL_URL = 'https://shipingongzuo.zeabur.app';

function formatHistoryTime(value: string | null): string {
    if (!value) return '刚刚';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '时间未知';
    }

    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function getStatusLabel(status: string): string {
    switch (status) {
        case 'queued':
            return '排队中';
        case 'processing':
            return '生成中';
        case 'completed':
            return '已完成';
        case 'failed':
            return '失败';
        default:
            return status || '未知';
    }
}

function getModeLabel(mode: string): string {
    switch (mode) {
        case 'text2video':
            return '文生视频';
        case 'image2video':
            return '图生视频';
        case 'keyframe':
            return '关键帧';
        case 'video2video':
            return '视频转视频';
        default:
            return mode || '未分类';
    }
}

function getRecordSummary(item: VideoGenerationHistoryItem): string {
    if (item.prompt?.trim()) return item.prompt.trim();
    if (item.errorMessage?.trim()) return item.errorMessage.trim();
    return '未提供生成描述';
}

function getPrimaryRecord(items: VideoGenerationHistoryItem[]): VideoGenerationHistoryItem | null {
    if (items.length === 0) return null;
    return items.find((item) => item.videoUrl) || items[0];
}

export default function VideoWorkbenchClient() {
    const router = useRouter();
    const { user, isAuthenticated, isLoading, loadUser } = useAuthStore();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [historyItems, setHistoryItems] = useState<VideoGenerationHistoryItem[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isHistoryLoading, setIsHistoryLoading] = useState(true);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [launchError, setLaunchError] = useState<string | null>(null);
    const [isLaunching, setIsLaunching] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        void loadUser();
    }, [loadUser]);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.replace(`/login?redirect=${encodeURIComponent(WORKBENCH_ROUTE)}`);
        }
    }, [isAuthenticated, isLoading, router]);

    async function loadHistory(silent = false) {
        if (!silent) {
            setIsHistoryLoading(true);
        }
        setHistoryError(null);

        try {
            const items = await api.getVideoGenerationHistory({ limit: 50 });
            setHistoryItems(items);
            setSelectedId((current) => {
                if (current && items.some((item) => item.id === current)) {
                    return current;
                }
                return getPrimaryRecord(items)?.id ?? null;
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : '加载历史记录失败';
            setHistoryError(message);
        } finally {
            setIsHistoryLoading(false);
        }
    }

    useEffect(() => {
        if (!isAuthenticated) return;
        void loadHistory();
    }, [isAuthenticated]);

    const selectedItem = useMemo(
        () => historyItems.find((item) => item.id === selectedId) || getPrimaryRecord(historyItems),
        [historyItems, selectedId],
    );

    async function handleOpenStudio() {
        if (!isAuthenticated) {
            router.push(`/login?redirect=${encodeURIComponent(WORKBENCH_ROUTE)}`);
            return;
        }

        setLaunchError(null);
        setIsLaunching(true);
        try {
            const result = await api.startVideoSso();
            const targetUrl = result.url || VIDEO_WORKBENCH_EXTERNAL_URL;
            window.open(targetUrl, '_blank', 'noopener,noreferrer');
        } catch (error) {
            const message = error instanceof ApiError ? error.message : '打开视频工作站失败';
            setLaunchError(message);
        } finally {
            setIsLaunching(false);
        }
    }

    async function handleDeleteHistoryItem(id: string) {
        if (typeof window !== 'undefined' && !window.confirm('确认删除这条视频历史记录吗？')) {
            return;
        }

        setDeletingId(id);
        try {
            await api.deleteVideoGenerationHistoryItem(id);
            setHistoryItems((current) => current.filter((item) => item.id !== id));
            setSelectedId((current) => (current === id ? null : current));
        } catch (error) {
            const message = error instanceof Error ? error.message : '删除历史记录失败';
            setHistoryError(message);
        } finally {
            setDeletingId(null);
        }
    }

    if (isLoading || !isAuthenticated) {
        return (
            <div className={styles.stateShell}>
                <div className={styles.stateCard}>
                    <div className={styles.stateIcon}>
                        <Video size={28} />
                    </div>
                    <h1 className={styles.stateTitle}>视频工作站入口</h1>
                    <p className={styles.stateText}>正在校验主站登录状态并准备历史记录。</p>
                    <div className={styles.stateStatus}>
                        <Loader2 size={18} className={styles.spinner} />
                        <span>正在加载...</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.shell}>
            <div
                className={`${styles.drawerMask} ${drawerOpen ? styles.drawerMaskVisible : ''}`}
                onClick={() => setDrawerOpen(false)}
            />

            <aside className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ''}`}>
                <div className={styles.drawerHeader}>
                    <div>
                        <p className={styles.drawerEyebrow}>历史生成记录</p>
                        <h2 className={styles.drawerTitle}>当前账号的视频历史</h2>
                    </div>
                    <button
                        type="button"
                        className={styles.refreshButton}
                        onClick={() => void loadHistory(true)}
                        disabled={isHistoryLoading}
                    >
                        <RefreshCcw size={16} className={isHistoryLoading ? styles.spinner : ''} />
                        <span>刷新</span>
                    </button>
                </div>

                <p className={styles.drawerHint}>
                    记录保存在主站服务器，并按当前账号 <strong>{user?.account}</strong> 隔离。
                </p>

                <div className={styles.drawerBody}>
                    {isHistoryLoading ? (
                        <div className={styles.emptyState}>
                            <Loader2 size={18} className={styles.spinner} />
                            <span>正在拉取历史记录...</span>
                        </div>
                    ) : historyError ? (
                        <div className={styles.errorState}>{historyError}</div>
                    ) : historyItems.length === 0 ? (
                        <div className={styles.emptyState}>
                            <History size={18} />
                            <span>当前账号还没有视频历史记录。</span>
                        </div>
                    ) : (
                        <div className={styles.historyList}>
                            {historyItems.map((item) => {
                                const isSelected = item.id === selectedItem?.id;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className={`${styles.historyCard} ${isSelected ? styles.historyCardActive : ''}`}
                                        onClick={() => {
                                            setSelectedId(item.id);
                                            if (typeof window !== 'undefined' && window.innerWidth < 960) {
                                                setDrawerOpen(false);
                                            }
                                        }}
                                    >
                                        <div className={styles.historyMetaRow}>
                                            <span className={`${styles.statusChip} ${styles[`status_${item.status}`] || ''}`}>
                                                {getStatusLabel(item.status)}
                                            </span>
                                            <span className={styles.historyTime}>{formatHistoryTime(item.createdAt)}</span>
                                        </div>
                                        <h3 className={styles.historyPrompt}>{getRecordSummary(item)}</h3>
                                        <div className={styles.historySubmeta}>
                                            <span>{item.engine || 'video'}</span>
                                            <span>{getModeLabel(item.mode)}</span>
                                            {item.model ? <span>{item.model}</span> : null}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </aside>

            <main className={styles.main}>
                <header className={styles.header}>
                    <div className={styles.headerBrand}>
                        <button
                            type="button"
                            className={styles.menuButton}
                            onClick={() => setDrawerOpen((current) => !current)}
                            aria-label="打开历史记录"
                        >
                            <Menu size={20} />
                        </button>
                        <div className={styles.logoBadge}>
                            <Video size={18} />
                        </div>
                        <div className={styles.titleGroup}>
                            <div className={styles.titleRow}>
                                <h1 className={styles.title}>视频工作站</h1>
                                <span className={styles.pill}>主站入口</span>
                            </div>
                            <p className={styles.subtitle}>点击左侧三条杠可查看历史生成记录，点击按钮可跳转外部视频站。</p>
                        </div>
                    </div>

                    <div className={styles.headerActions}>
                        <Link className={styles.backLink} href="/">
                            <House size={16} />
                            <span>返回首页</span>
                        </Link>
                        <button
                            type="button"
                            className={styles.openButton}
                            onClick={() => void handleOpenStudio()}
                            disabled={isLaunching}
                        >
                            {isLaunching ? <Loader2 size={16} className={styles.spinner} /> : <ExternalLink size={16} />}
                            <span>{isLaunching ? '正在打开...' : '打开视频站'}</span>
                        </button>
                    </div>
                </header>

                <section className={styles.content}>
                    <div className={styles.previewCard}>
                        <div className={styles.cardHeader}>
                            <div>
                                <p className={styles.cardEyebrow}>最近记录预览</p>
                                <h2 className={styles.cardTitle}>
                                    {selectedItem ? getRecordSummary(selectedItem) : '等待历史记录'}
                                </h2>
                            </div>
                            {selectedItem ? (
                                <span className={`${styles.statusChip} ${styles[`status_${selectedItem.status}`] || ''}`}>
                                    {getStatusLabel(selectedItem.status)}
                                </span>
                            ) : null}
                        </div>

                        <div className={styles.previewFrame}>
                            {selectedItem?.videoUrl ? (
                                <video
                                    key={selectedItem.videoUrl}
                                    src={selectedItem.videoUrl}
                                    controls
                                    playsInline
                                    className={styles.previewVideo}
                                />
                            ) : (
                                <div className={styles.placeholder}>
                                    <Video size={28} />
                                    <p>{selectedItem ? '该记录暂时没有可播放视频。' : '打开左侧抽屉后可选择历史视频记录。'}</p>
                                </div>
                            )}
                        </div>

                        {launchError ? <p className={styles.inlineError}>{launchError}</p> : null}
                    </div>

                    <aside className={styles.infoCard}>
                        <div className={styles.cardHeader}>
                            <div>
                                <p className={styles.cardEyebrow}>账号绑定</p>
                                <h2 className={styles.cardTitle}>历史记录与主站账号联动</h2>
                            </div>
                        </div>

                        <div className={styles.accountBlock}>
                            <span className={styles.accountLabel}>当前账号</span>
                            <strong>{user?.nickname || user?.account}</strong>
                            <span className={styles.accountSubtle}>{user?.account}</span>
                        </div>

                        <div className={styles.detailGrid}>
                            <div className={styles.detailItem}>
                                <span className={styles.detailLabel}>历史总数</span>
                                <strong>{historyItems.length}</strong>
                            </div>
                            <div className={styles.detailItem}>
                                <span className={styles.detailLabel}>最近时间</span>
                                <strong>{selectedItem ? formatHistoryTime(selectedItem.updatedAt) : '暂无'}</strong>
                            </div>
                            <div className={styles.detailItem}>
                                <span className={styles.detailLabel}>生成模式</span>
                                <strong>{selectedItem ? getModeLabel(selectedItem.mode) : '暂无'}</strong>
                            </div>
                            <div className={styles.detailItem}>
                                <span className={styles.detailLabel}>模型</span>
                                <strong>{selectedItem?.model || '未记录'}</strong>
                            </div>
                        </div>

                        {selectedItem?.errorMessage ? (
                            <div className={styles.detailAlert}>{selectedItem.errorMessage}</div>
                        ) : null}

                        <div className={styles.panelActions}>
                            <button type="button" className={styles.secondaryButton} onClick={() => setDrawerOpen(true)}>
                                <History size={16} />
                                <span>查看全部历史</span>
                            </button>

                            {selectedItem?.videoUrl ? (
                                <a
                                    className={styles.secondaryButton}
                                    href={selectedItem.videoUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    <ExternalLink size={16} />
                                    <span>新标签查看视频</span>
                                </a>
                            ) : null}

                            {selectedItem ? (
                                <button
                                    type="button"
                                    className={styles.dangerButton}
                                    onClick={() => void handleDeleteHistoryItem(selectedItem.id)}
                                    disabled={deletingId === selectedItem.id}
                                >
                                    {deletingId === selectedItem.id ? (
                                        <Loader2 size={16} className={styles.spinner} />
                                    ) : (
                                        <Trash2 size={16} />
                                    )}
                                    <span>{deletingId === selectedItem.id ? '删除中...' : '删除当前记录'}</span>
                                </button>
                            ) : null}
                        </div>

                        <div className={styles.timeline}>
                            <div className={styles.timelineItem}>
                                <Clock3 size={16} />
                                <div>
                                    <strong>1. 从主站打开视频站</strong>
                                    <p>主站通过登录态和 SSO 将当前账号带入视频站。</p>
                                </div>
                            </div>
                            <div className={styles.timelineItem}>
                                <Clock3 size={16} />
                                <div>
                                    <strong>2. 生成完成后回写主站</strong>
                                    <p>外部视频站将任务结果回写主站服务器后，历史记录会自动出现在这里。</p>
                                </div>
                            </div>
                        </div>
                    </aside>
                </section>
            </main>
        </div>
    );
}
