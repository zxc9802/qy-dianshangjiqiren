'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../stores/auth';

function readStoredToken(): string {
    if (typeof window === 'undefined') {
        return '';
    }

    return window.localStorage.getItem('token') || '';
}

function sanitizeVideoWorkspaceUrl(rawUrl: string): string {
    try {
        const parsed = new URL(rawUrl, window.location.origin);
        if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) {
            parsed.protocol = 'https:';
            parsed.host = 'shipingongzutai.zeabur.app';
        }
        return parsed.toString();
    } catch {
        return 'https://shipingongzutai.zeabur.app';
    }
}

export default function VideoGeneratorRedirectClient() {
    const router = useRouter();
    const { isAuthenticated, isLoading, token, loadUser } = useAuthStore();
    const [error, setError] = useState('');
    const [isRedirecting, setIsRedirecting] = useState(false);
    const hasStartedRef = useRef(false);

    useEffect(() => {
        void loadUser();
    }, [loadUser]);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.replace('/login');
        }
    }, [isAuthenticated, isLoading, router]);

    useEffect(() => {
        if (isLoading || !isAuthenticated || hasStartedRef.current) {
            return;
        }

        const bearerToken = token || readStoredToken();
        if (!bearerToken) {
            router.replace('/login');
            return;
        }

        hasStartedRef.current = true;
        setIsRedirecting(true);

        void (async () => {
            try {
                const response = await fetch('/api/video-sso/start', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${bearerToken}`,
                    },
                    body: JSON.stringify({}),
                });

                const payload = await response.json().catch(() => ({}));
                if (!response.ok || !payload?.url) {
                    throw new Error(payload?.error || payload?.message || 'Unable to open the video workspace.');
                }

                window.location.replace(sanitizeVideoWorkspaceUrl(payload.url as string));
            } catch (nextError) {
                const message = nextError instanceof Error ? nextError.message : 'Unable to open the video workspace.';
                hasStartedRef.current = false;
                setIsRedirecting(false);
                setError(message);
            }
        })();
    }, [isAuthenticated, isLoading, router, token]);

    return (
        <div style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
            background: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)',
        }}>
            <div style={{
                width: '100%',
                maxWidth: 520,
                padding: 32,
                borderRadius: 24,
                background: 'rgba(255,255,255,0.92)',
                boxShadow: '0 24px 80px rgba(15,23,42,0.12)',
                border: '1px solid rgba(148,163,184,0.18)',
                textAlign: 'center',
            }}>
                <div style={{
                    width: 64,
                    height: 64,
                    margin: '0 auto 20px',
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 20,
                    background: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
                    color: '#fff',
                }}>
                    <Video size={28} />
                </div>

                <h1 style={{ margin: 0, fontSize: 28, color: '#0f172a' }}>Opening Video Workspace</h1>
                <p style={{ margin: '12px 0 0', fontSize: 15, lineHeight: 1.6, color: '#475569' }}>
                    {error
                        ? 'The video workspace could not be opened from your current session.'
                        : 'Your main-site login is being verified and a secure session is being created for the independent video site.'}
                </p>

                <div style={{ marginTop: 28 }}>
                    {error ? (
                        <button
                            type="button"
                            onClick={() => {
                                setError('');
                                setIsRedirecting(false);
                                hasStartedRef.current = false;
                            }}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                                minWidth: 180,
                                height: 44,
                                borderRadius: 999,
                                border: 'none',
                                background: '#0f766e',
                                color: '#fff',
                                cursor: 'pointer',
                                fontWeight: 600,
                            }}
                        >
                            <RefreshCw size={16} />
                            Retry
                        </button>
                    ) : (
                        <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 10,
                            color: '#0f766e',
                            fontWeight: 600,
                        }}>
                            <Loader2 size={18} />
                            {isRedirecting ? 'Redirecting...' : 'Checking session...'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
