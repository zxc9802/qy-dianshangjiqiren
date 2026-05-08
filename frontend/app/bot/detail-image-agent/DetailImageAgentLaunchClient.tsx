'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, House, ImageIcon, Loader2 } from 'lucide-react';
import { DETAIL_IMAGE_AGENT_SITE_METADATA } from '@/app/lib/detail-image-agent-site';
import styles from '../video-workbench/VideoWorkbenchClient.module.css';

const DETAIL_IMAGE_AGENT_COPY = {
    badge: '图片生成工具入口',
    title: '登录主站后，直达店铺图片工具',
    description: '主站负责校验登录态并签发一次性 SSO ticket，进入图片工具后会自动关联主站账号与历史记录。',
    buttonLabel: '打开店铺图片工具',
} as const;

class DetailImageAgentLaunchError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'DetailImageAgentLaunchError';
        this.status = status;
    }
}

function getSsoErrorMessage(value: string | null): string | null {
    if (value === 'ticket_exchange_failed') {
        return '图片工具登录交换失败，请确认图片工具服务的 SSO 环境变量已配置后再重试。';
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

async function startDetailImageAgentSso(token: string, body?: { redirectPath?: string }) {
    const response = await fetch('/api/detail-image-agent-sso/start', {
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
            : payload?.error || payload?.message || '打开店铺图片工具失败。';
        throw new DetailImageAgentLaunchError(message, response.status);
    }

    return payload as { url?: string; expiresAt?: string };
}

export default function DetailImageAgentLaunchClient() {
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
        return `${DETAIL_IMAGE_AGENT_SITE_METADATA.entryPath}?${params.toString()}`;
    }, [openMode, redirectPath]);

    useEffect(() => {
        if (ssoErrorMessage) {
            setLaunchError(ssoErrorMessage);
        }
    }, [ssoErrorMessage]);

    const handleOpenDetailImageAgent = useCallback(async (mode: 'popup' | 'replace' = 'replace') => {
        setLaunchError(null);
        setIsLaunching(true);

        try {
            const token = readStoredToken();
            if (!token) {
                router.push(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
                return;
            }

            const result = await startDetailImageAgentSso(
                token,
                redirectPath ? { redirectPath } : undefined,
            );
            const targetUrl = result.url || DETAIL_IMAGE_AGENT_SITE_METADATA.defaultAppUrl;

            if (mode === 'popup') {
                window.open(targetUrl, '_blank', 'noopener,noreferrer');
                return;
            }

            window.location.assign(targetUrl);
        } catch (error) {
            if (error instanceof DetailImageAgentLaunchError && error.status === 401) {
                router.push(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
                return;
            }

            const message = error instanceof Error ? error.message : '打开店铺图片工具失败。';
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
        void handleOpenDetailImageAgent(openMode);
    }, [handleOpenDetailImageAgent, openMode, shouldAutoStart]);

    return (
        <div className={styles.shell}>
            <main className={styles.hero}>
                <Link className={styles.backLink} href="/">
                    <House size={16} />
                    <span>返回首页</span>
                </Link>

                <div className={styles.badge}>
                    <ImageIcon size={18} />
                    <span>{DETAIL_IMAGE_AGENT_COPY.badge}</span>
                </div>

                <h1 className={styles.title}>{DETAIL_IMAGE_AGENT_COPY.title}</h1>
                <p className={styles.description}>{DETAIL_IMAGE_AGENT_COPY.description}</p>

                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => void handleOpenDetailImageAgent(openMode)}
                        disabled={isLaunching}
                    >
                        {isLaunching ? <Loader2 size={16} className={styles.spinner} /> : <ExternalLink size={16} />}
                        <span>{isLaunching ? '正在打开...' : DETAIL_IMAGE_AGENT_COPY.buttonLabel}</span>
                    </button>
                </div>

                {launchError ? <p className={styles.caption}>{launchError}</p> : null}
                <p className={styles.caption}>{DETAIL_IMAGE_AGENT_SITE_METADATA.defaultAppUrl}</p>
            </main>
        </div>
    );
}
