'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Ban, Check, Coins, Copy, RefreshCw, TicketCheck } from 'lucide-react';
import { api, RechargeCodeInfo } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import styles from './recharge-codes.module.css';

function formatPoints(value: number): string {
    return new Intl.NumberFormat('zh-CN').format(value);
}

export default function RechargeCodesPage() {
    const router = useRouter();
    const { user, isAuthenticated, isLoading, loadUser } = useAuthStore();
    const [points, setPoints] = useState('1000');
    const [expiresInDays, setExpiresInDays] = useState('30');
    const [remark, setRemark] = useState('');
    const [codes, setCodes] = useState<RechargeCodeInfo[]>([]);
    const [latestCode, setLatestCode] = useState<RechargeCodeInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [revokingId, setRevokingId] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

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

    const loadCodes = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const response = await api.adminGetRechargeCodes();
            setCodes(response.data);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : '充值码加载失败。');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isAuthenticated || user?.role !== 'admin') return;
        void loadCodes();
    }, [isAuthenticated, loadCodes, user?.role]);

    const summary = useMemo(() => ({
        total: codes.length,
        unused: codes.filter((item) => (
            !item.isUsed
            && !item.revokedAt
            && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now())
        )).length,
        used: codes.filter((item) => item.isUsed).length,
    }), [codes]);

    async function copyCode(code: string) {
        try {
            await navigator.clipboard.writeText(code);
            setMessage(`充值码 ${code} 已复制。`);
        } catch {
            setError('复制失败，请检查浏览器剪贴板权限。');
        }
    }

    async function handleGenerate(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const amount = Number(points);
        const expiryDays = Number(expiresInDays);
        if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000) {
            setError('请输入大于 0 的整数积分。');
            return;
        }
        if (!Number.isSafeInteger(expiryDays) || expiryDays < 1 || expiryDays > 3650) {
            setError('有效期必须是 1 到 3650 天。');
            return;
        }

        setGenerating(true);
        setError('');
        setMessage('');
        try {
            const response = await api.adminCreateRechargeCode(amount, {
                expiresInDays: expiryDays,
                remark: remark.trim(),
            });
            setLatestCode(response.data);
            setCodes((current) => [response.data, ...current.filter((item) => item.id !== response.data.id)]);
            setMessage(`已生成 ${formatPoints(amount)} 积分充值码。`);
        } catch (generateError) {
            setError(generateError instanceof Error ? generateError.message : '充值码生成失败。');
        } finally {
            setGenerating(false);
        }
    }

    async function handleRevoke(id: string) {
        if (!window.confirm('确定作废这条未使用的充值码吗？')) return;
        setRevokingId(id);
        setError('');
        setMessage('');
        try {
            const response = await api.adminRevokeRechargeCode(id);
            setCodes((current) => current.map((item) => (
                item.id === id
                    ? { ...item, revokedAt: response.data.revokedAt }
                    : item
            )));
            setLatestCode((current) => current?.id === id ? null : current);
            setMessage('充值码已作废。');
        } catch (revokeError) {
            setError(revokeError instanceof Error ? revokeError.message : '充值码作废失败。');
        } finally {
            setRevokingId('');
        }
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
                    <p className={styles.eyebrow}>CREDIT DESK</p>
                    <h1>
                        <Coins size={30} />
                        积分充值
                    </h1>
                    <p className={styles.subtitle}>生成指定面额的一次性充值码，再复制给联系你的外部用户。</p>
                </div>
                <button className={styles.refreshBtn} type="button" onClick={() => void loadCodes()} disabled={loading}>
                    <RefreshCw className={loading ? styles.spinning : undefined} size={16} />
                    刷新记录
                </button>
            </header>

            {error && <div className={styles.error}>{error}</div>}
            {message && <div className={styles.success}>{message}</div>}

            <section className={styles.workbench}>
                <form className={styles.generatorCard} onSubmit={handleGenerate}>
                    <div className={styles.cardHeading}>
                        <span className={styles.stepNumber}>01</span>
                        <div>
                            <h2>设定充值积分</h2>
                            <p>每次只生成一条充值码，积分面额可自由填写。</p>
                        </div>
                    </div>
                    <label className={styles.pointsField}>
                        <span>充值积分</span>
                        <div>
                            <input
                                type="number"
                                min="1"
                                max="100000000"
                                step="1"
                                inputMode="numeric"
                                value={points}
                                onChange={(event) => setPoints(event.target.value)}
                                aria-label="充值积分"
                            />
                            <strong>积分</strong>
                        </div>
                    </label>
                    <label className={styles.pointsField}>
                        <span>有效期</span>
                        <div>
                            <input
                                type="number"
                                min="1"
                                max="3650"
                                step="1"
                                inputMode="numeric"
                                value={expiresInDays}
                                onChange={(event) => setExpiresInDays(event.target.value)}
                                aria-label="有效期天数"
                            />
                            <strong>天</strong>
                        </div>
                    </label>
                    <label className={styles.remarkField}>
                        <span>备注（可选）</span>
                        <input
                            type="text"
                            maxLength={200}
                            value={remark}
                            onChange={(event) => setRemark(event.target.value)}
                            placeholder="例如：客户名称或沟通渠道"
                        />
                    </label>
                    <div className={styles.quickAmounts}>
                        {[100, 500, 1000, 5000].map((amount) => (
                            <button key={amount} type="button" onClick={() => setPoints(String(amount))}>
                                {formatPoints(amount)}
                            </button>
                        ))}
                    </div>
                    <button className={styles.generateBtn} type="submit" disabled={generating}>
                        <TicketCheck size={18} />
                        {generating ? '正在生成...' : '生成一条充值码'}
                    </button>
                </form>

                <section className={styles.resultCard}>
                    <div className={styles.cardHeading}>
                        <span className={styles.stepNumber}>02</span>
                        <div>
                            <h2>交付给用户</h2>
                            <p>充值码只在生成后完整显示一次，成功兑换后立即失效。</p>
                        </div>
                    </div>
                    {latestCode ? (
                        <div className={styles.ticket}>
                            <span className={styles.ticketLabel}>本次生成</span>
                            <strong>{latestCode.code}</strong>
                            <div className={styles.ticketMeta}>
                                <span><Coins size={16} />{formatPoints(latestCode.points)} 积分</span>
                                <span><Check size={16} />仅限一次</span>
                            </div>
                            <button type="button" onClick={() => void copyCode(latestCode.code)}>
                                <Copy size={17} />
                                复制充值码
                            </button>
                        </div>
                    ) : (
                        <div className={styles.emptyTicket}>
                            <TicketCheck size={34} />
                            <p>填写积分并生成后，充值码会显示在这里。</p>
                        </div>
                    )}
                </section>
            </section>

            <section className={styles.historyCard}>
                <div className={styles.historyHeading}>
                    <div>
                        <p className={styles.eyebrow}>LAST 100 CODES</p>
                        <h2>充值码记录</h2>
                    </div>
                    <div className={styles.summary}>
                        <span>共 {summary.total}</span>
                        <span>未使用 {summary.unused}</span>
                        <span>已兑换 {summary.used}</span>
                    </div>
                </div>

                <div className={styles.table}>
                    <div className={styles.tableHeader}>
                        <span>充值码</span>
                        <span>积分</span>
                        <span>状态</span>
                        <span>兑换用户</span>
                        <span>生成时间</span>
                    </div>
                    {!loading && codes.length === 0 ? (
                        <div className={styles.emptyRow}>还没有生成充值码。</div>
                    ) : codes.map((item) => (
                        <div className={styles.tableRow} key={item.id}>
                            <span className={styles.codeCell}>
                                <strong>{item.code}</strong>
                                {item.codeVisibleOnce && !item.isUsed && !item.revokedAt && (
                                    <button type="button" onClick={() => void copyCode(item.code)} aria-label={`复制 ${item.code}`}>
                                        <Copy size={14} />
                                    </button>
                                )}
                            </span>
                            <span>{formatPoints(item.points)}</span>
                            <span className={styles.statusCell}>
                                <em className={item.isUsed || item.revokedAt ? styles.usedBadge : styles.unusedBadge}>
                                    {item.isUsed
                                        ? '已兑换'
                                        : item.revokedAt
                                            ? '已作废'
                                            : item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now()
                                                ? '已过期'
                                                : '未使用'}
                                </em>
                                {!item.isUsed && !item.revokedAt && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now()) && (
                                    <button
                                        type="button"
                                        className={styles.revokeBtn}
                                        onClick={() => void handleRevoke(item.id)}
                                        disabled={revokingId === item.id}
                                    >
                                        <Ban size={13} />
                                        {revokingId === item.id ? '作废中' : '作废'}
                                    </button>
                                )}
                            </span>
                            <span>{item.usedBy ? item.usedBy.nickname || item.usedBy.account || item.usedBy.id : '—'}</span>
                            <span>{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                        </div>
                    ))}
                </div>
            </section>
        </main>
    );
}
