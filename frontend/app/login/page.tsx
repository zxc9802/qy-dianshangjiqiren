'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot } from 'lucide-react';
import { ApiError } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import styles from './login.module.css';

type AuthMode = 'login' | 'register' | 'activate';

export default function LoginPage() {
    const [mode, setMode] = useState<AuthMode>('login');
    const [account, setAccount] = useState('');
    const [password, setPassword] = useState('');
    const [nickname, setNickname] = useState('');
    const [groupName, setGroupName] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const router = useRouter();
    const { login, register, activate } = useAuthStore();

    const setModeAndResetError = (nextMode: AuthMode) => {
        setMode(nextMode);
        setError('');
    };

    const isRegister = mode === 'register';
    const isActivate = mode === 'activate';
    const showInviteCode = isRegister || isActivate;
    const showProfileFields = isRegister || isActivate;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (mode === 'login') {
                await login(account, password);
            } else if (mode === 'register') {
                await register(account, password, inviteCode, nickname, groupName);
            } else {
                await activate(account, password, inviteCode, nickname, groupName);
            }

            router.push('/');
        } catch (err) {
            if (err instanceof ApiError) {
                if (err.code === 'INVITE_REQUIRED') {
                    setMode('activate');
                    setError('该账号尚未获得成员权限，请填写邀请码、姓名和组别完成激活。');
                } else if (err.code === 'ACCOUNT_EXISTS_USE_ACTIVATE') {
                    setMode('activate');
                    setError('该账号已存在，但还没有完成成员激活。请填写邀请码、姓名和组别后继续。');
                } else if (err.code === 'INVITE_CODE_INVALID') {
                    setError('邀请码无效或已被使用。');
                } else if (err.code === 'PROFILE_NAME_REQUIRED') {
                    setMode('activate');
                    setError('激活成员账号前必须填写姓名。');
                } else if (err.code === 'PROFILE_GROUP_REQUIRED') {
                    setMode('activate');
                    setError('激活成员账号前必须填写组别。');
                } else {
                    setError(err.message);
                }
            } else {
                setError(err instanceof Error ? err.message : '操作失败，请稍后重试。');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.brandPanel}>
                <div className={styles.brandContent}>
                    <div className={styles.brandLogo}><Bot size={40} /></div>
                    <h1 className={styles.brandTitle}>电商 AI 智能平台</h1>
                    <p className={styles.brandSub}>企业内部使用，请先登录账号，再通过邀请码完成成员准入与权限激活。</p>
                    <div className={styles.features}>
                        <span className={styles.featureTag}>34 个预设机器人</span>
                        <span className={styles.featureTag}>支持自定义工作流</span>
                        <span className={styles.featureTag}>插件与主站账号同步</span>
                    </div>
                </div>
            </div>

            <div className={styles.formPanel}>
                <div className={styles.formContainer}>
                    <div className={styles.tabs}>
                        <button
                            type="button"
                            className={`${styles.tab} ${mode === 'login' ? styles.tabActive : ''}`}
                            onClick={() => setModeAndResetError('login')}
                        >
                            登录
                        </button>
                        <button
                            type="button"
                            className={`${styles.tab} ${mode === 'register' ? styles.tabActive : ''}`}
                            onClick={() => setModeAndResetError('register')}
                        >
                            注册
                        </button>
                        <button
                            type="button"
                            className={`${styles.tab} ${mode === 'activate' ? styles.tabActive : ''}`}
                            onClick={() => setModeAndResetError('activate')}
                        >
                            激活成员
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className={styles.form}>
                        <div className={styles.field}>
                            <label className={styles.label}>账号</label>
                            <input
                                type="text"
                                value={account}
                                onChange={(event) => setAccount(event.target.value)}
                                placeholder="请输入账号"
                                required
                                className={styles.input}
                            />
                        </div>

                        {showProfileFields && (
                            <>
                                <div className={styles.field}>
                                    <label className={styles.label}>姓名</label>
                                    <input
                                        type="text"
                                        value={nickname}
                                        onChange={(event) => setNickname(event.target.value)}
                                        placeholder="请输入真实姓名"
                                        className={styles.input}
                                        maxLength={20}
                                        required
                                    />
                                </div>

                                <div className={styles.field}>
                                    <label className={styles.label}>组别</label>
                                    <input
                                        type="text"
                                        value={groupName}
                                        onChange={(event) => setGroupName(event.target.value)}
                                        placeholder="例如：运营组 / 设计组 / 销售组"
                                        className={styles.input}
                                        maxLength={50}
                                        required
                                    />
                                </div>
                            </>
                        )}

                        <div className={styles.field}>
                            <label className={styles.label}>密码</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                placeholder={mode === 'login' ? '请输入密码' : '请输入至少 6 位密码'}
                                required
                                className={styles.input}
                            />
                        </div>

                        {showInviteCode && (
                            <div className={styles.field}>
                                <label className={styles.label}>邀请码</label>
                                <input
                                    type="text"
                                    value={inviteCode}
                                    onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                                    placeholder="请输入管理员发放的邀请码"
                                    required
                                    className={styles.input}
                                />
                            </div>
                        )}

                        {showInviteCode && (
                            <p className={styles.switchHint}>
                                邀请码为一次性凭证。成员注册和激活都需要填写邀请码，并补全姓名与组别。
                            </p>
                        )}

                        {error ? <p className={styles.error}>{error}</p> : null}

                        <button type="submit" className={styles.submitBtn} disabled={loading}>
                            {loading ? '提交中...' : mode === 'login' ? '登录' : mode === 'register' ? '注册并进入' : '激活成员权限'}
                        </button>

                        <p className={styles.switchHint}>
                            {mode === 'login' ? '还没有账号？' : mode === 'register' ? '已经有账号？' : '返回普通登录？'}
                            <button
                                type="button"
                                className={styles.switchBtn}
                                onClick={() => setModeAndResetError(mode === 'login' ? 'register' : 'login')}
                            >
                                {mode === 'login' ? '去注册' : '返回登录'}
                            </button>
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
}
