'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/auth';
import styles from './profile.module.css';
import { Settings, ArrowLeft } from 'lucide-react';

export default function ProfilePage() {
    const router = useRouter();
    const { user, logout } = useAuthStore();
    const [isEditing, setIsEditing] = useState(false);
    const [nickname, setNickname] = useState('');

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

    if (!user) return null;

    return (
        <div className={styles.layout}>
            {/* Sidebar */}
            <aside className={styles.sidebar}>
                <button className={styles.backBtn} onClick={() => router.push('/')}><ArrowLeft size={16} /> 返回首页</button>

                <div className={styles.avatarSection}>
                    <div className={styles.avatar}>
                        {user.nickname.slice(0, 1).toUpperCase()}
                    </div>
                    <h3 className={styles.sidebarName}>{user.nickname}</h3>
                    <p className={styles.sidebarPhone}>{user.email}</p>
                </div>

                <nav className={styles.sidebarNav}>
                    <button className={`${styles.navItem} ${styles.navActive}`}>
                        <Settings size={16} /> 账号设置
                    </button>
                </nav>

                <button className={styles.logoutBtn} onClick={logout}>退出登录</button>
            </aside>

            {/* Main content */}
            <main className={styles.content}>
                <h2 className={styles.pageTitle}><Settings size={20} /> 账号设置</h2>

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
            </main>
        </div>
    );
}
