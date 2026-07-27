'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
import { AdminUsageInfo, api, UsageRecordInfo } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import styles from './usage.module.css';

const EMPTY_USAGE: AdminUsageInfo = {
    totals: {
        requests: 0,
        totalTokens: 0,
        upstreamCostCny: 0,
        costCredits: 0,
        chargedCredits: 0,
    },
    rows: [],
};

function formatNumber(value: number | null | undefined): string {
    return new Intl.NumberFormat('zh-CN').format(value || 0);
}

function formatUsage(record: UsageRecordInfo): string {
    if (record.billingUnit === 'second') return `${record.billableUnits || 0} 秒`;
    if (record.billingUnit === 'image') return `${record.billableUnits || 0} 张`;
    return `${formatNumber(record.totalTokens)} tokens`;
}

export default function AdminUsagePage() {
    const router = useRouter();
    const { user, isAuthenticated, isLoading, loadUser } = useAuthStore();
    const [usage, setUsage] = useState<AdminUsageInfo>(EMPTY_USAGE);
    const [filters, setFilters] = useState({ userId: '', appId: '', model: '' });
    const [activeFilters, setActiveFilters] = useState(filters);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        void loadUser();
    }, [loadUser]);

    useEffect(() => {
        if (isLoading) return;
        if (!isAuthenticated) {
            router.replace('/login');
            return;
        }
        if (user && user.role !== 'admin') {
            router.replace('/');
        }
    }, [isAuthenticated, isLoading, router, user]);

    const loadUsage = useCallback(async (nextFilters: typeof activeFilters) => {
        setLoading(true);
        setError('');
        try {
            const response = await api.adminGetUsage({
                userId: nextFilters.userId.trim() || undefined,
                appId: nextFilters.appId.trim() || undefined,
                model: nextFilters.model.trim() || undefined,
                limit: 100,
            });
            setUsage(response.data);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : '用量记录加载失败。');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isAuthenticated || user?.role !== 'admin') return;
        void loadUsage(activeFilters);
    }, [activeFilters, isAuthenticated, loadUsage, user?.role]);

    function handleSearch(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setActiveFilters({ ...filters });
    }

    if (isLoading || !user || user.role !== 'admin') {
        return <div className={styles.loading}>正在验证管理员权限...</div>;
    }

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <div>
                    <button className={styles.backLink} type="button" onClick={() => router.push('/profile')}>
                        <ArrowLeft size={16} />
                        返回账号设置
                    </button>
                    <h1>AI 用量监控</h1>
                    <p>统一查看文本 Token、视频秒数、图片张数、实际成本和外部计费积分。</p>
                </div>
                <button className={styles.refreshBtn} type="button" onClick={() => void loadUsage(activeFilters)} disabled={loading}>
                    <RefreshCw className={loading ? styles.spinning : undefined} size={16} />
                    刷新
                </button>
            </header>

            <section className={styles.stats}>
                <div className={styles.statCard}>
                    <span>成功请求</span>
                    <strong>{formatNumber(usage.totals.requests)}</strong>
                </div>
                <div className={styles.statCard}>
                    <span>总 Token</span>
                    <strong>{formatNumber(usage.totals.totalTokens)}</strong>
                </div>
                <div className={styles.statCard}>
                    <span>实际成本</span>
                    <strong>¥{usage.totals.upstreamCostCny.toFixed(4)}</strong>
                </div>
                <div className={styles.statCard}>
                    <span>成本积分</span>
                    <strong>{formatNumber(usage.totals.costCredits)}</strong>
                </div>
                <div className={styles.statCard}>
                    <span>外部计费积分</span>
                    <strong>{formatNumber(usage.totals.chargedCredits)}</strong>
                </div>
            </section>

            <form className={styles.filters} onSubmit={handleSearch}>
                <label>
                    <span>用户 ID</span>
                    <input
                        value={filters.userId}
                        onChange={(event) => setFilters((current) => ({ ...current, userId: event.target.value }))}
                        placeholder="精确匹配"
                    />
                </label>
                <label>
                    <span>应用</span>
                    <input
                        value={filters.appId}
                        onChange={(event) => setFilters((current) => ({ ...current, appId: event.target.value }))}
                        placeholder="main / buyer-show / kb-chat / seedance"
                    />
                </label>
                <label>
                    <span>模型</span>
                    <input
                        value={filters.model}
                        onChange={(event) => setFilters((current) => ({ ...current, model: event.target.value }))}
                        placeholder="精确模型名"
                    />
                </label>
                <button type="submit" disabled={loading}>
                    <Search size={16} />
                    查询
                </button>
            </form>

            {error && <div className={styles.error}>{error}</div>}

            <section className={styles.tableCard} aria-busy={loading}>
                <div className={styles.tableHeader}>
                    <span>用户</span>
                    <span>应用 / 模型</span>
                    <span>用量</span>
                    <span>实际成本</span>
                    <span>计费积分</span>
                    <span>账号类型</span>
                    <span>时间</span>
                </div>
                {!loading && usage.rows.length === 0 ? (
                    <div className={styles.empty}>没有符合条件的用量记录。</div>
                ) : usage.rows.map((record) => (
                    <div className={styles.tableRow} key={record.id}>
                        <span>
                            <strong>{record.userNickname || record.userEmail || record.userId || '-'}</strong>
                            <small>{record.userId || '-'}</small>
                        </span>
                        <span>
                            <strong>{record.appId || record.channel}</strong>
                            <small>{record.model || '-'}</small>
                        </span>
                        <span>{formatUsage(record)}</span>
                        <span>¥{record.upstreamCostCny.toFixed(4)}</span>
                        <span>{formatNumber(record.chargedCredits)}</span>
                        <span>
                            <em className={record.billingAudience === 'internal' ? styles.internalBadge : styles.externalBadge}>
                                {record.billingAudience === 'internal' ? '内部' : '外部'}
                            </em>
                        </span>
                        <span>{new Date(record.createdAt).toLocaleString('zh-CN')}</span>
                    </div>
                ))}
            </section>
        </main>
    );
}
