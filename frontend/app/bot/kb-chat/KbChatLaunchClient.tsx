'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BookOpen, ExternalLink, House, Loader2 } from 'lucide-react';
import { KB_CHAT_SITE_METADATA } from '@/app/lib/kb-chat-site';
import styles from '../video-workbench/VideoWorkbenchClient.module.css';

const KB_CHAT_COPY = {
    badge: '知识库机器人入口',
    title: '登录主站后，直达知识库机器人',
    description: '主站负责校验登录态并签发一次性 SSO ticket。进入知识库机器人后，只允许已经登录主站的成员继续访问。',
    buttonLabel: '打开知识库机器人',
} as const;

class KbChatLaunchError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'KbChatLaunchError';
        this.status = status;
    }
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

async function startKbChatSso(body?: { redirectPath?: string }) {
    const token = readStoredToken();
    const response = await fetch('/api/kb-chat-sso/start', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
            : payload?.error || payload?.message || '打开知识库机器人失败。';
        throw new KbChatLaunchError(message, response.status);
    }

    return payload as { url?: string; expiresAt?: string };
}

export default function KbChatLaunchClient() {
    const [isLaunching, setIsLaunching] = useState(false);
    const [launchError, setLaunchError] = useState<string | null>(null);
    const router = useRouter();
    const searchParams = useSearchParams();
    const autoLaunchRef = useRef(false);

    const shouldAutoStart = searchParams.get('autostart') === '1';
    const openMode = searchParams.get('openMode') === 'popup' ? 'popup' : 'replace';
    const redirectPath = normalizeRedirectPath(searchParams.get('redirectPath'));

    const loginRedirectPath = useMemo(() => {
        const params = new URLSearchParams();
        params.set('autostart', '1');
        params.set('openMode', openMode);
        if (redirectPath) {
            params.set('redirectPath', redirectPath);
        }
        return `${KB_CHAT_SITE_METADATA.entryPath}?${params.toString()}`;
    }, [openMode, redirectPath]);

    const handleOpenKbChat = useCallback(async (mode: 'popup' | 'replace' = 'replace') => {
        setLaunchError(null);
        setIsLaunching(true);

        try {
            const result = await startKbChatSso(
                redirectPath ? { redirectPath } : undefined,
            );
            const targetUrl = result.url || KB_CHAT_SITE_METADATA.defaultAppUrl;

            if (mode === 'popup') {
                window.open(targetUrl, '_blank', 'noopener,noreferrer');
                return;
            }

            window.location.replace(targetUrl);
        } catch (error) {
            if (error instanceof KbChatLaunchError && error.status === 401) {
                router.push(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
                return;
            }

            const message = error instanceof Error ? error.message : '打开知识库机器人失败。';
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
        void handleOpenKbChat(openMode);
    }, [handleOpenKbChat, openMode, shouldAutoStart]);

    return (
        <div className={styles.shell}>
            <main className={styles.hero}>
                <Link className={styles.backLink} href="/">
                    <House size={16} />
                    <span>返回首页</span>
                </Link>

                <div className={styles.badge}>
                    <BookOpen size={18} />
                    <span>{KB_CHAT_COPY.badge}</span>
                </div>

                <h1 className={styles.title}>{KB_CHAT_COPY.title}</h1>
                <p className={styles.description}>{KB_CHAT_COPY.description}</p>

                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => void handleOpenKbChat(openMode)}
                        disabled={isLaunching}
                    >
                        {isLaunching ? <Loader2 size={16} className={styles.spinner} /> : <ExternalLink size={16} />}
                        <span>{isLaunching ? '正在打开...' : KB_CHAT_COPY.buttonLabel}</span>
                    </button>
                </div>

                {launchError ? <p className={styles.caption}>{launchError}</p> : null}
                <p className={styles.caption}>{KB_CHAT_SITE_METADATA.defaultAppUrl}</p>
            </main>
        </div>
    );
}
