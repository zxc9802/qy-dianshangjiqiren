'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/auth';
import styles from './profile.module.css';

interface Transaction {
    id: string;
    time: string;
    type: string;
    description: string;
    amount: number;
    balance: number;
}

const MOCK_TRANSACTIONS: Transaction[] = [
    { id: '1', time: '2026-02-26 10:30', type: '充值', description: '购买500积分套餐', amount: 100, balance: 600 },
    { id: '2', time: '2026-02-26 14:45', type: '消耗', description: '使用卖点教练功能', amount: -5, balance: 595 },
    { id: '3', time: '2026-02-26 15:12', type: '消耗', description: '使用天猫趋势拆解', amount: -8, balance: 587 },
    { id: '4', time: '2026-02-26 16:30', type: '奖励', description: '每日签到', amount: 5, balance: 592 },
    { id: '5', time: '2026-02-26 18:00', type: '消耗', description: '使用AI对话功能', amount: -3, balance: 589 },
    { id: '6', time: '2026-02-25 10:00', type: '奖励', description: '新用户注册奖励', amount: 500, balance: 500 },
];

type SidebarTab = 'points' | 'settings';

export default function ProfilePage() {
    const router = useRouter();
    const { user, logout, updatePoints } = useAuthStore();
    const [activeTab, setActiveTab] = useState<SidebarTab>('points');
    const [isEditing, setIsEditing] = useState(false);
    const [nickname, setNickname] = useState('');
    const [showRecharge, setShowRecharge] = useState(false);

    useEffect(() => {
        if (!user && typeof window !== 'undefined') {
            const stored = localStorage.getItem('user');
            if (!stored) router.push('/login');
        }
        if (user) setNickname(user.nickname);
    }, [user, router]);

    const handleSaveNickname = () => {
        if (!nickname.trim()) return;
        const stored = localStorage.getItem('user');
        if (stored) {
            const u = JSON.parse(stored);
            u.nickname = nickname.trim();
            localStorage.setItem('user', JSON.stringify(u));
            useAuthStore.setState({ user: u });
        }
        setIsEditing(false);
    };

    const handleRecharge = (amount: number) => {
        const newBalance = (user?.pointsBalance || 0) + amount;
        updatePoints(newBalance);
        setShowRecharge(false);
    };

    if (!user) return null;

    return (
        <div className={styles.layout}>
            {/* Sidebar */}
            <aside className={styles.sidebar}>
                <button className={styles.backBtn} onClick={() => router.push('/')}>← 返回首页</button>

                <div className={styles.avatarSection}>
                    <div className={styles.avatar}>
                        {user.nickname.slice(0, 1).toUpperCase()}
                    </div>
                    <h3 className={styles.sidebarName}>{user.nickname}</h3>
                    <p className={styles.sidebarPhone}>{user.email}</p>
                </div>

                <nav className={styles.sidebarNav}>
                    <button
                        className={`${styles.navItem} ${activeTab === 'points' ? styles.navActive : ''}`}
                        onClick={() => setActiveTab('points')}
                    >
                        💰 积分管理
                    </button>

                    <button
                        className={`${styles.navItem} ${activeTab === 'settings' ? styles.navActive : ''}`}
                        onClick={() => setActiveTab('settings')}
                    >
                        ⚙️ 账号设置
                    </button>
                </nav>

                <button className={styles.logoutBtn} onClick={logout}>退出登录</button>
            </aside>

            {/* Main content */}
            <main className={styles.content}>
                {activeTab === 'points' && (
                    <>
                        <h2 className={styles.pageTitle}>💰 积分管理</h2>

                        <div className={styles.pointsCard}>
                            <div className={styles.pointsInfo}>
                                <span className={styles.pointsValue}>{user.pointsBalance}</span>
                                <span className={styles.pointsLabel}>当前可用积分</span>
                            </div>
                            <button className={styles.rechargeBtn} onClick={() => setShowRecharge(!showRecharge)}>充值</button>
                        </div>

                        {showRecharge && (
                            <div className={styles.rechargeGrid}>
                                {[
                                    { pts: 100, price: 10 },
                                    { pts: 500, price: 45, tag: '最受欢迎' },
                                    { pts: 1000, price: 80 },
                                    { pts: 3000, price: 200 },
                                ].map(pkg => (
                                    <div key={pkg.pts} className={styles.rechargeItem} onClick={() => handleRecharge(pkg.pts)}>
                                        {pkg.tag && <span className={styles.rechargeTag}>{pkg.tag}</span>}
                                        <span className={styles.rechargePts}>{pkg.pts}积分</span>
                                        <span className={styles.rechargePrice}>¥{pkg.price}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <h3 className={styles.sectionTitle}>积分明细</h3>
                        <div className={styles.table}>
                            <div className={styles.tableHeader}>
                                <span>时间</span>
                                <span>类型</span>
                                <span>描述</span>
                                <span>积分变动</span>
                                <span>余额</span>
                            </div>
                            {MOCK_TRANSACTIONS.map(tx => (
                                <div key={tx.id} className={styles.tableRow}>
                                    <span>{tx.time}</span>
                                    <span>{tx.type}</span>
                                    <span>{tx.description}</span>
                                    <span className={tx.amount > 0 ? styles.positive : styles.negative}>
                                        {tx.amount > 0 ? '+' : ''}{tx.amount}
                                    </span>
                                    <span>{tx.balance}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {activeTab === 'settings' && (
                    <>
                        <h2 className={styles.pageTitle}>⚙️ 账号设置</h2>

                        <div className={styles.settingsCard}>
                            <div className={styles.settingRow}>
                                <span className={styles.settingLabel}>昵称</span>
                                {isEditing ? (
                                    <div className={styles.editRow}>
                                        <input
                                            className={styles.editInput}
                                            value={nickname}
                                            onChange={e => setNickname(e.target.value)}
                                            autoFocus
                                            maxLength={20}
                                        />
                                        <button className={styles.saveBtn} onClick={handleSaveNickname}>保存</button>
                                        <button className={styles.cancelBtn} onClick={() => { setIsEditing(false); setNickname(user.nickname); }}>取消</button>
                                    </div>
                                ) : (
                                    <div className={styles.settingValue}>
                                        <span>{user.nickname}</span>
                                        <button className={styles.editBtnSmall} onClick={() => setIsEditing(true)}>修改</button>
                                    </div>
                                )}
                            </div>
                            <div className={styles.settingRow}>
                                <span className={styles.settingLabel}>邮箱</span>
                                <span className={styles.settingValue}>{user.email}</span>
                            </div>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
