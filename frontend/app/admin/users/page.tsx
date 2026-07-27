'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Search, Users } from 'lucide-react';
import { AdminUserInfo, AdminUsersInfo, ApiError, api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import styles from './users.module.css';

const EMPTY_DATA: AdminUsersInfo = {
    totals: { total: 0, internal: 0, external: 0, suspended: 0 },
    rows: [],
};

function formatPoints(value: number): string {
    return new Intl.NumberFormat('zh-CN').format(value);
}

type Filters = {
    q: string;
    billingAudience: '' | 'internal' | 'external';
    accountStatus: '' | 'active' | 'suspended';
};

export default function AdminUsersPage() {
    const router = useRouter();
    const { user, isAuthenticated, isLoading, loadUser } = useAuthStore();
    const [data, setData] = useState<AdminUsersInfo>(EMPTY_DATA);
    const [filters, setFilters] = useState<Filters>({
        q: '',
        billingAudience: '',
        accountStatus: '',
    });
    const [activeFilters, setActiveFilters] = useState(filters);
    const [loading, setLoading] = useState(false);
    const [updatingId, setUpdatingId] = useState('');
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

    const loadUsers = useCallback(async (nextFilters: Filters) => {
        setLoading(true);
        setError('');
        try {
            const response = await api.adminGetUsers({
                q: nextFilters.q.trim() || undefined,
                billingAudience: nextFilters.billingAudience || undefined,
                accountStatus: nextFilters.accountStatus || undefined,
                limit: 200,
            });
            setData(response.data);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : '账号列表加载失败。');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isAuthenticated || user?.role !== 'admin') return;
        void loadUsers(activeFilters);
    }, [activeFilters, isAuthenticated, loadUsers, user?.role]);

    function handleSearch(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setActiveFilters({ ...filters });
    }

    async function updateAccount(
        target: AdminUserInfo,
        change: {
            billingAudience?: 'internal' | 'external';
            accountStatus?: 'active' | 'suspended';
            nickname?: string;
            groupName?: string;
        },
    ) {
        const actionLabel = change.accountStatus === 'suspended'
            ? '暂停'
            : change.accountStatus === 'active'
                ? '恢复'
                : change.billingAudience === 'internal'
                    ? '设为内部账号'
                    : '设为外部账号';
        if (!window.confirm(`确认${actionLabel}“${target.nickname || target.account}”吗？`)) {
            return;
        }

        setUpdatingId(target.id);
        setError('');
        setMessage('');
        try {
            await api.adminUpdateUser(target.id, change);
            setMessage(`账号“${target.nickname || target.account}”已${actionLabel}。`);
            await loadUsers(activeFilters);
        } catch (updateError) {
            if (updateError instanceof ApiError && updateError.code === 'INTERNAL_PROFILE_REQUIRED') {
                setError('设为内部账号前，该账号的姓名和组别必须属于内部员工名单。');
            } else {
                setError(updateError instanceof Error ? updateError.message : '账号更新失败。');
            }
        } finally {
            setUpdatingId('');
        }
    }

    function updateBillingAudience(
        target: AdminUserInfo,
        billingAudience: 'internal' | 'external',
    ) {
        if (billingAudience === target.billingAudience) return;
        if (billingAudience === 'external') {
            void updateAccount(target, { billingAudience });
            return;
        }

        const nickname = window.prompt('请输入固定员工名单中的姓名：', target.nickname);
        if (nickname === null) return;
        const groupName = window.prompt(
            '请输入固定组别名单中的组别：',
            target.groupName === '外部用户' ? '' : target.groupName,
        );
        if (groupName === null) return;
        void updateAccount(target, {
            billingAudience,
            nickname: nickname.trim(),
            groupName: groupName.trim(),
        });
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
                    <h1>
                        <Users size={30} />
                        账号管理
                    </h1>
                    <p>统一管理内部与外部账号。账号类型决定计费规则，账号状态会同步影响主站和子应用 SSO。</p>
                </div>
                <button className={styles.refreshBtn} type="button" onClick={() => void loadUsers(activeFilters)} disabled={loading}>
                    <RefreshCw className={loading ? styles.spinning : undefined} size={16} />
                    刷新
                </button>
            </header>

            <section className={styles.stats}>
                <div><span>全部账号</span><strong>{data.totals.total}</strong></div>
                <div><span>内部账号</span><strong>{data.totals.internal}</strong></div>
                <div><span>外部账号</span><strong>{data.totals.external}</strong></div>
                <div><span>已暂停</span><strong>{data.totals.suspended}</strong></div>
            </section>

            <form className={styles.filters} onSubmit={handleSearch}>
                <label>
                    <span>搜索账号</span>
                    <input
                        value={filters.q}
                        onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
                        placeholder="邮箱、昵称或组别"
                    />
                </label>
                <label>
                    <span>账号类型</span>
                    <select
                        value={filters.billingAudience}
                        onChange={(event) => setFilters((current) => ({
                            ...current,
                            billingAudience: event.target.value as Filters['billingAudience'],
                        }))}
                    >
                        <option value="">全部</option>
                        <option value="internal">内部账号</option>
                        <option value="external">外部账号</option>
                    </select>
                </label>
                <label>
                    <span>账号状态</span>
                    <select
                        value={filters.accountStatus}
                        onChange={(event) => setFilters((current) => ({
                            ...current,
                            accountStatus: event.target.value as Filters['accountStatus'],
                        }))}
                    >
                        <option value="">全部</option>
                        <option value="active">正常</option>
                        <option value="suspended">已暂停</option>
                    </select>
                </label>
                <button type="submit" disabled={loading}>
                    <Search size={16} />
                    查询
                </button>
            </form>

            {error && <div className={styles.error}>{error}</div>}
            {message && <div className={styles.success}>{message}</div>}

            <section className={styles.tableCard} aria-busy={loading}>
                <div className={styles.tableHeader}>
                    <span>账号</span>
                    <span>身份</span>
                    <span>账号类型</span>
                    <span>状态</span>
                    <span>积分余额</span>
                    <span>最后登录</span>
                    <span>注册时间</span>
                </div>
                {!loading && data.rows.length === 0 ? (
                    <div className={styles.empty}>没有符合条件的账号。</div>
                ) : data.rows.map((item) => {
                    const updating = updatingId === item.id;
                    const isAdmin = item.role === 'admin';
                    return (
                        <div className={styles.tableRow} key={item.id}>
                            <span>
                                <strong>{item.nickname || '-'}</strong>
                                <small>{item.account}</small>
                            </span>
                            <span>
                                <strong>{item.role === 'admin' ? '管理员' : item.groupName || '成员'}</strong>
                                <small>{item.id}</small>
                            </span>
                            <select
                                value={item.billingAudience}
                                disabled={updating || isAdmin}
                                onChange={(event) => updateBillingAudience(
                                    item,
                                    event.target.value as 'internal' | 'external',
                                )}
                            >
                                <option value="internal">内部账号</option>
                                <option value="external">外部账号</option>
                            </select>
                            <select
                                value={item.accountStatus}
                                disabled={updating || isAdmin}
                                onChange={(event) => void updateAccount(item, {
                                    accountStatus: event.target.value as 'active' | 'suspended',
                                })}
                            >
                                <option value="active">正常</option>
                                <option value="suspended">已暂停</option>
                            </select>
                            <span>{item.billingAudience === 'external' ? formatPoints(item.pointsBalance) : '—'}</span>
                            <span>{item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString('zh-CN') : '尚未登录'}</span>
                            <span>{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                        </div>
                    );
                })}
            </section>
        </main>
    );
}
