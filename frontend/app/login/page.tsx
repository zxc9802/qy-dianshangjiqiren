'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bot, Building2, Globe2, LogIn } from 'lucide-react';
import SearchableSelect from '../components/SearchableSelect';
import { ApiError } from '../lib/api';
import {
    FIXED_GROUP_NAMES,
    FIXED_MEMBER_NAMES,
    isAllowedGroupName,
    isAllowedMemberName,
} from '../lib/member-directory';
import { useAuthStore } from '../stores/auth';
import styles from './login.module.css';

type AuthMode = 'login' | 'external-register' | 'internal-register';

function getRegisterSelectionError(nickname: string, groupName: string): string {
    if (!nickname && !groupName) {
        return '请选择名单中的姓名和组别。';
    }

    if (!nickname) {
        return '请选择名单中的姓名。';
    }

    if (!groupName) {
        return '请选择名单中的组别。';
    }

    if (!isAllowedMemberName(nickname)) {
        return '姓名不在固定名单中，请重新搜索并选择。';
    }

    if (!isAllowedGroupName(groupName)) {
        return '组别不在固定名单中，请重新搜索并选择。';
    }

    return '';
}

function LoginPageContent() {
    const [mode, setMode] = useState<AuthMode>('login');
    const [account, setAccount] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [nickname, setNickname] = useState('');
    const [groupName, setGroupName] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const router = useRouter();
    const searchParams = useSearchParams();
    const { login, registerExternal, registerInternal } = useAuthStore();
    const redirectTarget = searchParams.get('redirect') || '/';
    const isExternalRegister = mode === 'external-register';
    const isInternalRegister = mode === 'internal-register';

    const setModeAndResetError = (nextMode: AuthMode) => {
        setMode(nextMode);
        setError('');
        setConfirmPassword('');
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');

        if (isInternalRegister) {
            const selectionError = getRegisterSelectionError(nickname, groupName);
            if (selectionError) {
                setError(selectionError);
                return;
            }
        }

        if (isExternalRegister) {
            if (!account.includes('@')) {
                setError('外部账号请使用有效邮箱注册。');
                return;
            }
            if (password.length < 8) {
                setError('外部账号密码至少需要 8 位。');
                return;
            }
            if (password !== confirmPassword) {
                setError('两次输入的密码不一致。');
                return;
            }
        }

        setLoading(true);

        try {
            if (mode === 'login') {
                await login(account, password);
            } else if (mode === 'external-register') {
                await registerExternal(account, password, nickname);
            } else {
                await registerInternal(account, password, inviteCode, nickname, groupName);
            }

            router.push(redirectTarget);
        } catch (err) {
            if (err instanceof ApiError) {
                if (err.code === 'INVITE_REQUIRED') {
                    setMode('internal-register');
                    setError('该账号尚未完成成员开通，请填写邀请码、姓名和组别后继续注册。');
                } else if (err.code === 'ACCOUNT_EXISTS_USE_ACTIVATE') {
                    setMode('internal-register');
                    setError('该账号已存在但尚未开通权限，请使用原账号和密码填写邀请码后继续注册。');
                } else if (err.code === 'ACCOUNT_ALREADY_EXISTS') {
                    setError('该邮箱已经注册，请直接登录。');
                } else if (err.code === 'EXTERNAL_REGISTRATION_DISABLED') {
                    setError('外部用户注册暂未开放，请联系管理员。');
                } else if (err.code === 'ACCOUNT_SUSPENDED') {
                    setMode('login');
                    setError('该账号已被暂停，请联系管理员处理。');
                } else if (err.code === 'INVITE_CODE_INVALID') {
                    setError('邀请码无效或已被使用。');
                } else if (err.code === 'PROFILE_NAME_REQUIRED') {
                    setMode(isExternalRegister ? 'external-register' : 'internal-register');
                    setError('注册时必须选择姓名。');
                } else if (err.code === 'PROFILE_GROUP_REQUIRED') {
                    setMode('internal-register');
                    setError('注册时必须选择组别。');
                } else if (err.code === 'PROFILE_NAME_INVALID') {
                    setMode('internal-register');
                    setError('姓名不在固定名单中，请重新搜索并选择。');
                } else if (err.code === 'PROFILE_GROUP_INVALID') {
                    setMode('internal-register');
                    setError('组别不在固定名单中，请重新搜索并选择。');
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
                    <p className={styles.brandSub}>一套账号连接全部 AI 工具，内部成员与外部用户使用独立权限和计费规则。</p>
                    <div className={styles.features}>
                        <span className={styles.featureTag}>统一登录与跨站同步</span>
                        <span className={styles.featureTag}>内部账号成本监控</span>
                        <span className={styles.featureTag}>外部账号按量计费</span>
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
                            <LogIn size={15} />
                            登录
                        </button>
                        <button
                            type="button"
                            className={`${styles.tab} ${mode === 'external-register' ? styles.tabActive : ''}`}
                            onClick={() => setModeAndResetError('external-register')}
                        >
                            <Globe2 size={15} />
                            外部注册
                        </button>
                        <button
                            type="button"
                            className={`${styles.tab} ${mode === 'internal-register' ? styles.tabActive : ''}`}
                            onClick={() => setModeAndResetError('internal-register')}
                        >
                            <Building2 size={15} />
                            内部开通
                        </button>
                    </div>

                    {mode === 'login' ? (
                        <div className={styles.modeIntro}>
                            <strong>登录已有账号</strong>
                            <span>内部与外部用户共用同一个登录入口。</span>
                        </div>
                    ) : null}

                    <form onSubmit={handleSubmit} className={styles.form}>
                        <div className={styles.field}>
                            <label className={styles.label}>{isExternalRegister ? '邮箱' : '账号'}</label>
                            <input
                                type={isExternalRegister ? 'email' : 'text'}
                                value={account}
                                onChange={(event) => {
                                    setAccount(event.target.value);
                                    if (error) setError('');
                                }}
                                placeholder={isExternalRegister ? 'name@example.com' : '请输入账号或邮箱'}
                                required
                                autoComplete="username"
                                className={styles.input}
                            />
                        </div>

                        {isExternalRegister ? (
                            <div className={styles.field}>
                                <label className={styles.label}>昵称</label>
                                <input
                                    type="text"
                                    value={nickname}
                                    onChange={(event) => {
                                        setNickname(event.target.value);
                                        if (error) setError('');
                                    }}
                                    placeholder="请输入显示名称"
                                    required
                                    maxLength={40}
                                    className={styles.input}
                                />
                            </div>
                        ) : null}

                        {isInternalRegister ? (
                            <>
                                <SearchableSelect
                                    label="姓名"
                                    options={FIXED_MEMBER_NAMES}
                                    value={nickname}
                                    onChange={(nextValue) => {
                                        setNickname(nextValue);
                                        if (error) setError('');
                                    }}
                                    placeholder="输入姓名关键词后选择，例如：张"
                                    required
                                    helperText="姓名固定为 30 人名单，只能搜索并选择。"
                                    noResultsText="未搜索到名单内姓名，不能自定义输入。"
                                />

                                <SearchableSelect
                                    label="组别"
                                    options={FIXED_GROUP_NAMES}
                                    value={groupName}
                                    onChange={(nextValue) => {
                                        setGroupName(nextValue);
                                        if (error) setError('');
                                    }}
                                    placeholder="输入组别关键词后选择，例如：技术"
                                    required
                                    helperText="组别固定为指定名单，其他项排在最后。"
                                    noResultsText="未搜索到可选组别，不能自定义输入。"
                                />
                            </>
                        ) : null}

                        <div className={styles.field}>
                            <label className={styles.label}>密码</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(event) => {
                                    setPassword(event.target.value);
                                    if (error) setError('');
                                }}
                                placeholder={mode === 'login'
                                    ? '请输入密码'
                                    : isExternalRegister
                                        ? '请输入至少 8 位密码'
                                        : '请输入至少 6 位密码'}
                                required
                                minLength={isExternalRegister ? 8 : undefined}
                                maxLength={128}
                                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                className={styles.input}
                            />
                        </div>

                        {isExternalRegister ? (
                            <div className={styles.field}>
                                <label className={styles.label}>确认密码</label>
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(event) => {
                                        setConfirmPassword(event.target.value);
                                        if (error) setError('');
                                    }}
                                    placeholder="请再次输入密码"
                                    required
                                    minLength={8}
                                    maxLength={128}
                                    autoComplete="new-password"
                                    className={styles.input}
                                />
                            </div>
                        ) : null}

                        {isInternalRegister ? (
                            <div className={styles.field}>
                                <label className={styles.label}>邀请码</label>
                                <input
                                    type="text"
                                    value={inviteCode}
                                    onChange={(event) => {
                                        setInviteCode(event.target.value.toUpperCase());
                                        if (error) setError('');
                                    }}
                                    placeholder="请输入管理员发放的邀请码"
                                    required
                                    className={styles.input}
                                />
                            </div>
                        ) : null}

                        {isInternalRegister ? (
                            <p className={styles.switchHint}>
                                邀请码为一次性凭证。注册时请填写邀请码，并从固定名单中搜索选择姓名与组别。
                            </p>
                        ) : isExternalRegister ? (
                            <p className={styles.switchHint}>
                                注册即创建外部账号。内部员工请使用“内部开通”，不要注册为外部用户。
                            </p>
                        ) : null}

                        {error ? <p className={styles.error}>{error}</p> : null}

                        <button type="submit" className={styles.submitBtn} disabled={loading}>
                            {loading
                                ? '提交中...'
                                : mode === 'login'
                                    ? '登录'
                                    : isExternalRegister
                                        ? '注册外部账号'
                                        : '开通内部账号'}
                        </button>

                        {mode === 'login' ? (
                            <div className={styles.switchActions}>
                                <button
                                    type="button"
                                    className={styles.switchBtn}
                                    onClick={() => setModeAndResetError('external-register')}
                                >
                                    我是外部用户，去注册
                                </button>
                                <button
                                    type="button"
                                    className={styles.switchBtn}
                                    onClick={() => setModeAndResetError('internal-register')}
                                >
                                    我是内部成员，去开通
                                </button>
                            </div>
                        ) : (
                            <p className={styles.switchHint}>
                                已经有账号？
                                <button
                                    type="button"
                                    className={styles.switchBtn}
                                    onClick={() => setModeAndResetError('login')}
                                >
                                    返回登录
                                </button>
                            </p>
                        )}
                    </form>
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense>
            <LoginPageContent />
        </Suspense>
    );
}
