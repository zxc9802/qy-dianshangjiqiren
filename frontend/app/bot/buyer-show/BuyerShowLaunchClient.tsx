'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, House, ImageIcon, Loader2 } from 'lucide-react';
import { BUYER_SHOW_SITE_METADATA } from '@/app/lib/buyer-show-site';
import styles from '../video-workbench/VideoWorkbenchClient.module.css';

const BUYER_SHOW_COPY = {
    badge: '买家秀智能体入口',
    title: '登录主站后，直达买家秀智能体',
    description: '主站负责校验登录态并签发一次性 SSO ticket，进入买家秀智能体后会自动关联主站账号与历史记录。',
    buttonLabel: '打开买家秀智能体',
} as const;

class BuyerShowLaunchError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'BuyerShowLaunchError';
        this.status = status;
    }
}

function getSsoErrorMessage(value: string | null): string | null {
    if (value === 'ticket_exchange_failed') {
        return '买家秀智能体登录交换失败，请确认买家秀服务的 SSO 环境变量已配置后再重试。';
    }
    return null;
}

function normalizeRedirectPath(value: string | null): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) {
        return undefined;
    }
    return trimmed;
}

function readStoredToken(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('token');
}

async function startBuyerShowSso(token: string, body?: { redirectPath?: string }) {
    const response = await fetch('/api/buyer-show-sso/start', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body || {}),
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
        ? await response.json().catch(() => null)
        : await response.text();

    if (!response.ok) {
        const message = typeof payload === 'string'
            ? payload
            : payload?.error || payload?.message || '打开买家秀智能体失败。';
        throw new BuyerShowLaunchError(message, response.status);
    }

    return payload as { url?: string; expiresAt?: string };
}

export default function BuyerShowLaunchClient() {
    const [isLaunching, setIsLaunching] = useState(false);
    const [launchError, setLaunchError] = useState<string | null>(null);
    const router = useRouter();
    const searchParams = useSearchParams();
    const autoLaunchRef = useRef(false);

    const shouldAutoStart = searchParams.get('autostart') === '1';
    const openMode = searchParams.get('openMode') === 'popup' ? 'popup' : 'replace';
    const redirectPath = normalizeRedirectPath(searchParams.get('redirectPath'));
    const ssoErrorMessage = getSsoErrorMessage(searchParams.get('ssoError'));

    const loginRedirectPath = useMemo(() => {
        const params = new URLSearchParams();
        params.set('autostart', '1');
        params.set('openMode', openMode);
        if (redirectPath) {
            params.set('redirectPath', redirectPath);
        }
        return `${BUYER_SHOW_SITE_METADATA.entryPath}?${params.toString()}`;
    }, [openMode, redirectPath]);

    useEffect(() => {
        if (ssoErrorMessage) {
            setLaunchError(ssoErrorMessage);
        }
    }, [ssoErrorMessage]);

    const handleOpenBuyerShow = useCallback(async (mode: 'popup' | 'replace' = 'replace') => {
        setLaunchError(null);
        setIsLaunching(true);

        try {
            const token = readStoredToken();
            if (!token) {
                router.push(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
                return;
            }

            const result = await startBuyerShowSso(
                token,
                redirectPath ? { redirectPath } : undefined,
            );
            const targetUrl = result.url || BUYER_SHOW_SITE_METADATA.defaultAppUrl;

            if (mode === 'popup') {
                window.open(targetUrl, '_blank', 'noopener,noreferrer');
                return;
            }

            window.location.assign(targetUrl);
        } catch (error) {
            if (error instanceof BuyerShowLaunchError && error.status === 401) {
                router.push(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
                return;
            }

            const message = error instanceof Error ? error.message : '打开买家秀智能体失败。';
            setLaunchError(message);
        } finally {
            setIsLaunching(false);
        }
    }, [loginRedirectPath, redirectPath, router]);

    useEffect(() => {
        if (!shouldAutoStart || autoLaunchRef.current) {
            return;
        }

        autoLaunchRef.current = true;
        void handleOpenBuyerShow(openMode);
    }, [handleOpenBuyerShow, openMode, shouldAutoStart]);

    return (
        <div className={styles.shell}>
            <main className={styles.hero}>
                <Link className={styles.backLink} href="/">
                    <House size={16} />
                    <span>返回首页</span>
                </Link>

                <div className={styles.badge}>
                    <ImageIcon size={18} />
                    <span>{BUYER_SHOW_COPY.badge}</span>
                </div>

                <h1 className={styles.title}>{BUYER_SHOW_COPY.title}</h1>
                <p className={styles.description}>{BUYER_SHOW_COPY.description}</p>

                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => void handleOpenBuyerShow(openMode)}
                        disabled={isLaunching}
                    >
                        {isLaunching ? <Loader2 size={16} className={styles.spinner} /> : <ExternalLink size={16} />}
                        <span>{isLaunching ? '正在打开...' : BUYER_SHOW_COPY.buttonLabel}</span>
                    </button>
                </div>

                {launchError ? <p className={styles.caption}>{launchError}</p> : null}
                <p className={styles.caption}>{BUYER_SHOW_SITE_METADATA.defaultAppUrl}</p>
            </main>
        </div>
    );
}
