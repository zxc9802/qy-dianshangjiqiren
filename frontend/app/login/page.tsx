'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/auth';
import styles from './login.module.css';

export default function LoginPage() {
    const [isLogin, setIsLogin] = useState(true);
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [nickname, setNickname] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const { login, register } = useAuthStore();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            if (isLogin) {
                await login(phone, password);
            } else {
                await register(phone, password, nickname || undefined);
            }
            router.push('/');
        } catch (err) {
            setError(err instanceof Error ? err.message : '操作失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            {/* Left branding panel */}
            <div className={styles.brandPanel}>
                <div className={styles.brandContent}>
                    <div className={styles.brandLogo}>🤖</div>
                    <h1 className={styles.brandTitle}>电商AI智能平台</h1>
                    <p className={styles.brandSub}>你的一站式电商AI顾问团</p>
                    <div className={styles.features}>
                        <span className={styles.featureTag}>✦ 34个专业智能体</span>
                        <span className={styles.featureTag}>✦ 智能工作流引擎</span>
                        <span className={styles.featureTag}>✦ 安全文件上传</span>
                    </div>
                </div>
            </div>

            {/* Right form panel */}
            <div className={styles.formPanel}>
                <div className={styles.formContainer}>
                    <div className={styles.tabs}>
                        <button
                            className={`${styles.tab} ${isLogin ? styles.tabActive : ''}`}
                            onClick={() => { setIsLogin(true); setError(''); }}
                        >
                            登录
                        </button>
                        <button
                            className={`${styles.tab} ${!isLogin ? styles.tabActive : ''}`}
                            onClick={() => { setIsLogin(false); setError(''); }}
                        >
                            注册
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className={styles.form}>
                        <div className={styles.field}>
                            <label className={styles.label}>手机号</label>
                            <input
                                type="tel"
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                placeholder="请输入手机号"
                                required
                                className={styles.input}
                            />
                        </div>

                        {!isLogin && (
                            <div className={styles.field}>
                                <label className={styles.label}>昵称</label>
                                <input
                                    type="text"
                                    value={nickname}
                                    onChange={e => setNickname(e.target.value)}
                                    placeholder="给自己取个名字（选填）"
                                    className={styles.input}
                                />
                            </div>
                        )}

                        <div className={styles.field}>
                            <label className={styles.label}>密码</label>
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder={isLogin ? '请输入密码' : '设置密码（至少6位）'}
                                required
                                className={styles.input}
                            />
                        </div>

                        {error && <p className={styles.error}>{error}</p>}

                        <button type="submit" className={styles.submitBtn} disabled={loading}>
                            {loading ? '处理中...' : isLogin ? '登录' : '注册'}
                        </button>

                        <p className={styles.switchHint}>
                            {isLogin ? '还没有账号？' : '已有账号？'}
                            <button type="button" className={styles.switchBtn} onClick={() => { setIsLogin(!isLogin); setError(''); }}>
                                {isLogin ? '立即注册' : '去登录'}
                            </button>
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
}
