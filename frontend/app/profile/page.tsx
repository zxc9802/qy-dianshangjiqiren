'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowLeft, BarChart3, Coins, KeyRound, Settings, ShieldCheck, Users } from 'lucide-react';
import SearchableSelect from '../components/SearchableSelect';
import { api, ApiError, UsageSummaryInfo } from '../lib/api';
import { CREDITS_PER_CNY } from '../lib/ai-usage';
import { FIXED_MEMBER_NAMES } from '../lib/member-directory';
import { useAuthStore } from '../stores/auth';
import styles from './profile.module.css';

const EMPTY_USAGE: UsageSummaryInfo = {
    totals: {
        requests: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        upstreamCostCny: 0,
        costCredits: 0,
        chargedCredits: 0,
    },
    recent: [],
};

function formatNumber(value: number | null | undefined): string {
    return new Intl.NumberFormat('zh-CN').format(value || 0);
}

function formatUsageUnit(record: UsageSummaryInfo['recent'][number]): string {
    if (record.billingUnit === 'second') return `${record.billableUnits || 0} 秒`;
    if (record.billingUnit === 'image') return `${record.billableUnits || 0} 张`;
    return `${formatNumber(record.totalTokens)} tokens`;
}

export default function ProfilePage() {
    const router = useRouter();
    const { user, logout, loadUser } = useAuthStore();
    const [isEditing, setIsEditing] = useState(false);
    const [nickname, setNickname] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
    const [usage, setUsage] = useState<UsageSummaryInfo>(EMPTY_USAGE);
    const [usageLoading, setUsageLoading] = useState(true);
    const [usageError, setUsageError] = useState('');
    const [rechargeCode, setRechargeCode] = useState('');
    const [redeeming, setRedeeming] = useState(false);

    useEffect(() => {
        void loadUser();
    }, [loadUser]);

    useEffect(() => {
        if (!user && typeof window !== 'undefined') {
            const stored = localStorage.getItem('user');
            if (!stored) {
                router.push('/login');
            }
        }
    }, [router, user]);

    useEffect(() => {
        if (!user || user.billingAudience !== 'internal') return;

        let cancelled = false;
        setUsageLoading(true);
        setUsageError('');
        void api.getUsageSummary()
            .then((response) => {
                if (!cancelled) setUsage(response.data);
            })
            .catch((error) => {
                if (!cancelled) {
                    setUsageError(error instanceof Error ? error.message : '用量数据加载失败。');
                }
            })
            .finally(() => {
                if (!cancelled) setUsageLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [user]);

    const handleSaveNickname = async () => {
        const nextNickname = nickname.trim();
        if (!nextNickname || !user || isSaving) return;

        setIsSaving(true);
        setFeedback(null);

        try {
            const response = await api.updateProfile({ nickname: nextNickname });
            const nextUser = response.data;
            localStorage.setItem('user', JSON.stringify(nextUser));
            useAuthStore.setState({ user: nextUser });
            setNickname(nextUser.nickname);
            setIsEditing(false);
            setFeedback({ type: 'success', message: '姓名已保存。' });
        } catch (error) {
            if (error instanceof ApiError && error.code === 'PROFILE_NAME_INVALID') {
                setFeedback({ type: 'error', message: '姓名不在固定名单中，请重新搜索并选择。' });
            } else {
                setFeedback({ type: 'error', message: error instanceof Error ? error.message : '姓名保存失败。' });
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleRedeem = async () => {
        const code = rechargeCode.trim();
        if (!code || !user || redeeming) return;

        setRedeeming(true);
        setFeedback(null);
        try {
            const response = await api.redeemRechargeCode(code);
            const nextUser = {
                ...user,
                pointsBalance: response.data.newBalance,
            };
            localStorage.setItem('user', JSON.stringify(nextUser));
            useAuthStore.setState({ user: nextUser });
            setRechargeCode('');
            setFeedback({
                type: 'success',
                message: `充值成功，已到账 ${formatNumber(response.data.pointsAdded)} 积分。`,
            });
        } catch (error) {
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : '充值码兑换失败。',
            });
        } finally {
            setRedeeming(false);
        }
    };

    if (!user) {
        return null;
    }

    return (
        <div className={styles.layout}>
            <aside className={styles.sidebar}>
                <button className={styles.backBtn} onClick={() => router.push('/')}>
                    <ArrowLeft size={16} />
                    返回首页
                </button>

                <div className={styles.avatarSection}>
                    <div className={styles.avatar}>
                        {(user.nickname || user.account).slice(0, 1).toUpperCase()}
                    </div>
                    <h3 className={styles.sidebarName}>{user.nickname || user.account}</h3>
                    <p className={styles.sidebarPhone}>{user.account}</p>
                </div>

                <nav className={styles.sidebarNav}>
                    <button className={`${styles.navItem} ${styles.navActive}`} type="button">
                        <Settings size={16} />
                        账号设置
                    </button>
                    {user.role === 'admin' && (
                        <>
                            <button className={styles.navItem} type="button" onClick={() => router.push('/admin/invite-codes')}>
                                <ShieldCheck size={16} />
                                邀请码管理
                            </button>
                            <button className={styles.navItem} type="button" onClick={() => router.push('/admin/usage')}>
                                <BarChart3 size={16} />
                                用量监控
                            </button>
                            <button className={styles.navItem} type="button" onClick={() => router.push('/admin/users')}>
                                <Users size={16} />
                                账号管理
                            </button>
                            <button className={styles.navItem} type="button" onClick={() => router.push('/admin/recharge-codes')}>
                                <Coins size={16} />
                                积分充值
                            </button>
                        </>
                    )}
                </nav>

                <button className={styles.logoutBtn} onClick={logout}>退出登录</button>
            </aside>

            <main className={styles.content}>
                <h2 className={styles.pageTitle}>
                    <Settings size={20} />
                    账号设置
                </h2>

                {feedback && (
                    <div className={feedback.type === 'success' ? styles.successText : styles.errorText}>
                        {feedback.message}
                    </div>
                )}

                {user.billingAudience === 'external' && (
                    <section className={styles.creditSection}>
                        <div className={styles.pointsCard}>
                            <div className={styles.pointsInfo}>
                                <span className={styles.pointsEyebrow}>AVAILABLE CREDIT</span>
                                <span className={styles.pointsValue}>{formatNumber(user.pointsBalance)}</span>
                                <span className={styles.pointsLabel}>当前积分余额</span>
                            </div>
                            <Coins size={54} strokeWidth={1.3} aria-hidden="true" />
                        </div>
                        <div className={styles.redeemPanel}>
                            <div>
                                <KeyRound size={20} />
                                <span>
                                    <strong>使用管理员提供的充值码</strong>
                                    <small>充值码仅可兑换一次，到账后余额会立即更新。</small>
                                </span>
                            </div>
                            <form onSubmit={(event) => {
                                event.preventDefault();
                                void handleRedeem();
                            }}>
                                <input
                                    value={rechargeCode}
                                    onChange={(event) => {
                                        setRechargeCode(event.target.value.toUpperCase());
                                        setFeedback(null);
                                    }}
                                    maxLength={64}
                                    autoComplete="off"
                                    placeholder="JF-XXXX-XXXX-XXXX-XXXX"
                                    aria-label="积分充值码"
                                    disabled={redeeming}
                                />
                                <button type="submit" disabled={redeeming || !rechargeCode.trim()}>
                                    {redeeming ? '兑换中...' : '立即兑换'}
                                </button>
                            </form>
                        </div>
                        <div className={styles.creditNotice}>
                            <span className={styles.creditNoticeTitle}>积分说明</span>
                            <span className={styles.creditRate}>
                                <strong>{formatNumber(CREDITS_PER_CNY)} 积分</strong>
                                <span>=</span>
                                <strong>¥1</strong>
                            </span>
                        </div>
                    </section>
                )}

                <div className={styles.settingsCard}>
                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>姓名</span>
                        {isEditing ? (
                            <div className={styles.editRow}>
                                {user.billingAudience === 'internal' ? (
                                    <div className={styles.editSelect}>
                                        <SearchableSelect
                                            label="姓名"
                                            options={FIXED_MEMBER_NAMES}
                                            value={nickname}
                                            onChange={(nextValue) => {
                                                setNickname(nextValue);
                                                setFeedback(null);
                                            }}
                                            placeholder="输入姓名关键词后选择"
                                            helperText="姓名只能从固定 31 人名单中搜索选择。"
                                            noResultsText="未搜索到名单内姓名，不能自定义输入。"
                                            disabled={isSaving}
                                        />
                                    </div>
                                ) : (
                                    <input
                                        className={styles.editInput}
                                        value={nickname}
                                        onChange={(event) => {
                                            setNickname(event.target.value);
                                            setFeedback(null);
                                        }}
                                        maxLength={40}
                                        placeholder="输入显示昵称"
                                        disabled={isSaving}
                                    />
                                )}
                                <button className={styles.saveBtn} onClick={() => void handleSaveNickname()} disabled={isSaving || !nickname.trim()}>
                                    {isSaving ? '保存中...' : '保存'}
                                </button>
                                <button
                                    className={styles.cancelBtn}
                                    onClick={() => {
                                        setIsEditing(false);
                                        setNickname(user.nickname);
                                        setFeedback(null);
                                    }}
                                    disabled={isSaving}
                                >
                                    取消
                                </button>
                            </div>
                        ) : (
                            <div className={styles.settingValue}>
                                <span>{user.nickname || '-'}</span>
                                <button
                                    className={styles.editBtnSmall}
                                    onClick={() => {
                                        setNickname(user.nickname);
                                        setIsEditing(true);
                                        setFeedback(null);
                                    }}
                                >
                                    修改
                                </button>
                            </div>
                        )}
                    </div>

                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>账号</span>
                        <span className={styles.settingValue}>{user.account}</span>
                    </div>

                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>组别</span>
                        <span className={styles.settingValue}>{user.groupName || '-'}</span>
                    </div>

                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>角色</span>
                        <span className={styles.settingValue}>{user.role === 'admin' ? '管理员' : '成员'}</span>
                    </div>

                    <div className={styles.settingRow}>
                        <span className={styles.settingLabel}>账号类型</span>
                        <span className={styles.settingValue}>
                            {user.billingAudience === 'internal' ? '内部账号' : '外部账号'}
                        </span>
                    </div>
                </div>

                {user.billingAudience === 'internal' && (
                <section className={styles.usageSection}>
                    <div className={styles.usageHeading}>
                        <div>
                            <h2 className={styles.pageTitle}>
                                <Activity size={20} />
                                用量监控
                            </h2>
                            <p>
                                {user.billingAudience === 'internal'
                                    ? '内部账号只记录实际成本，不扣计费积分。'
                                    : '100 积分 = ¥1，实际使用产生的积分明细会记录在下方。'}
                            </p>
                        </div>
                        <span className={styles.audienceBadge}>
                            {user.billingAudience === 'internal' ? '内部账号' : '外部账号'}
                        </span>
                    </div>

                    {usageError ? (
                        <div className={styles.errorText}>{usageError}</div>
                    ) : (
                        <>
                            <div className={styles.usageStats} aria-busy={usageLoading}>
                                <div className={styles.usageStat}>
                                    <span>成功请求</span>
                                    <strong>{usageLoading ? '—' : formatNumber(usage.totals.requests)}</strong>
                                </div>
                                <div className={styles.usageStat}>
                                    <span>总 Token</span>
                                    <strong>{usageLoading ? '—' : formatNumber(usage.totals.totalTokens)}</strong>
                                </div>
                                <div className={styles.usageStat}>
                                    <span>实际成本</span>
                                    <strong>{usageLoading ? '—' : `¥${usage.totals.upstreamCostCny.toFixed(4)}`}</strong>
                                </div>
                                <div className={styles.usageStat}>
                                    <span>计费积分</span>
                                    <strong>{usageLoading ? '—' : formatNumber(usage.totals.chargedCredits)}</strong>
                                </div>
                            </div>

                            <div className={styles.usageList}>
                                <div className={styles.usageListHeader}>
                                    <span>{user.billingAudience === 'internal' ? '应用 / 模型' : '应用'}</span>
                                    <span>用量</span>
                                    <span>计费积分</span>
                                    <span>时间</span>
                                </div>
                                {!usageLoading && usage.recent.length === 0 ? (
                                    <div className={styles.emptyUsage}>还没有可显示的用量记录。</div>
                                ) : usage.recent.slice(0, 10).map((record) => (
                                    <div className={styles.usageListRow} key={record.id}>
                                        <span>
                                            <strong>{record.appId || record.channel}</strong>
                                            {user.billingAudience === 'internal' ? (
                                                <small>{record.model || '-'}</small>
                                            ) : null}
                                        </span>
                                        <span>{formatUsageUnit(record)}</span>
                                        <span>{formatNumber(record.chargedCredits)}</span>
                                        <span>{new Date(record.createdAt).toLocaleString('zh-CN')}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </section>
                )}
            </main>
        </div>
    );
}
