'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, House, Loader2, Smartphone } from 'lucide-react';
import { XHS_SITE_METADATA } from '@/app/lib/xhs-site';
import styles from '../video-workbench/VideoWorkbenchClient.module.css';

class XhsLaunchError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'XhsLaunchError';
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

async function startXhsSso(body?: { redirectPath?: string }) {
    const token = readStoredToken();
    const response = await fetch('/api/xhs-sso/start', {
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
            : payload?.error || payload?.message || 'Failed to open XHS auto publisher.';
        throw new XhsLaunchError(message, response.status);
    }

    return payload as { url?: string; expiresAt?: string };
}

export default function XhsAutoPublishLaunchClient() {
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
        return `${XHS_SITE_METADATA.entryPath}?${params.toString()}`;
    }, [openMode, redirectPath]);

    const handleOpenXhs = useCallback(async (mode: 'popup' | 'replace' = 'replace') => {
        setLaunchError(null);
        setIsLaunching(true);

        try {
            const result = await startXhsSso(redirectPath ? { redirectPath } : undefined);
            const targetUrl = result.url || XHS_SITE_METADATA.defaultAppUrl;

            if (mode === 'popup') {
                window.open(targetUrl, '_blank', 'noopener,noreferrer');
                return;
            }

            window.location.replace(targetUrl);
        } catch (error) {
            if (error instanceof XhsLaunchError && error.status === 401) {
                router.push(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
                return;
            }

            const message = error instanceof Error ? error.message : 'Failed to open XHS auto publisher.';
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
        void handleOpenXhs(openMode);
    }, [handleOpenXhs, openMode, shouldAutoStart]);

    return (
        <div className={styles.shell}>
            <main className={styles.hero}>
                <Link className={styles.backLink} href="/">
                    <House size={16} />
                    <span>Back home</span>
                </Link>

                <div className={styles.badge}>
                    <Smartphone size={18} />
                    <span>XHS auto publisher</span>
                </div>

                <h1 className={styles.title}>Open XHS auto publisher</h1>
                <p className={styles.description}>
                    The main site verifies your account and grants a one-time SSO ticket for the XHS publishing console.
                </p>

                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => void handleOpenXhs(openMode)}
                        disabled={isLaunching}
                    >
                        {isLaunching ? <Loader2 size={16} className={styles.spinner} /> : <ExternalLink size={16} />}
                        <span>{isLaunching ? 'Opening...' : 'Open XHS publisher'}</span>
                    </button>
                </div>

                {launchError ? <p className={styles.caption}>{launchError}</p> : null}
                <p className={styles.caption}>{XHS_SITE_METADATA.defaultAppUrl}</p>
            </main>
        </div>
    );
}
