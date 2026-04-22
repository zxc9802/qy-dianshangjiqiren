'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, House, Loader2, Video } from 'lucide-react';
import { ApiError, api, type VideoSiteKey } from '../../lib/api';
import { VIDEO_SITE_METADATA } from '../../lib/video-sites';
import styles from './VideoWorkbenchClient.module.css';

const VIDEO_WORKBENCH_COPY: Record<VideoSiteKey, {
    badge: string;
    title: string;
    description: string;
    buttonLabel: string;
}> = {
    seedance: {
        badge: '视频工作台入口',
        title: '登录主站后，直达视频工作台',
        description: '主站负责校验登录态并签发一次性 SSO ticket，进入视频工作台后会自动关联主站账号与历史记录。',
        buttonLabel: '打开视频工作台',
    },
    tiktok: {
        badge: 'TikTok Studio入口',
        title: '登录主站后，直达 TikTok Studio',
        description: '主站负责校验登录态并签发一次性 SSO ticket，进入 TikTok Studio 后会自动关联主站账号与历史记录。',
        buttonLabel: '打开 TikTok Studio',
    },
};

interface VideoWorkbenchClientProps {
    site: VideoSiteKey;
}

function normalizeRedirectPath(value: string | null): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) {
        return undefined;
    }
    return trimmed;
}

export default function VideoWorkbenchClient({ site }: VideoWorkbenchClientProps) {
    const [isLaunching, setIsLaunching] = useState(false);
    const [launchError, setLaunchError] = useState<string | null>(null);
    const router = useRouter();
    const searchParams = useSearchParams();
    const autoLaunchRef = useRef(false);

    const siteMeta = VIDEO_SITE_METADATA[site];
    const copy = useMemo(() => VIDEO_WORKBENCH_COPY[site], [site]);
    const shouldAutoStart = searchParams.get('autostart') === '1';
    const openMode = searchParams.get('openMode') === 'replace' ? 'replace' : 'popup';
    const redirectPath = normalizeRedirectPath(searchParams.get('redirectPath'));

    const loginRedirectPath = useMemo(() => {
        const params = new URLSearchParams();
        params.set('autostart', '1');
        if (openMode === 'replace') {
            params.set('openMode', 'replace');
        }
        if (redirectPath) {
            params.set('redirectPath', redirectPath);
        }
        return `${siteMeta.entryPath}?${params.toString()}`;
    }, [openMode, redirectPath, siteMeta.entryPath]);

    const handleOpenStudio = useCallback(async (mode: 'popup' | 'replace' = 'popup') => {
        setLaunchError(null);
        setIsLaunching(true);

        try {
            const result = await api.startVideoSso({
                site,
                ...(redirectPath ? { redirectPath } : {}),
            });
            const targetUrl = result.url || siteMeta.defaultAppUrl;

            if (mode === 'replace') {
                window.location.replace(targetUrl);
                return;
            }

            window.open(targetUrl, '_blank', 'noopener,noreferrer');
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) {
                router.push(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
                return;
            }

            const message = error instanceof ApiError ? error.message : '打开视频工作台失败。';
            setLaunchError(message);
        } finally {
            setIsLaunching(false);
        }
    }, [loginRedirectPath, redirectPath, router, site, siteMeta.defaultAppUrl]);

    useEffect(() => {
        if (!shouldAutoStart || autoLaunchRef.current) {
            return;
        }

        autoLaunchRef.current = true;
        void handleOpenStudio(openMode);
    }, [handleOpenStudio, openMode, shouldAutoStart]);

    return (
        <div className={styles.shell}>
            <main className={styles.hero}>
                <Link className={styles.backLink} href="/">
                    <House size={16} />
                    <span>返回首页</span>
                </Link>

                <div className={styles.badge}>
                    <Video size={18} />
                    <span>{copy.badge}</span>
                </div>

                <h1 className={styles.title}>{copy.title}</h1>
                <p className={styles.description}>{copy.description}</p>

                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => void handleOpenStudio()}
                        disabled={isLaunching}
                    >
                        {isLaunching ? <Loader2 size={16} className={styles.spinner} /> : <ExternalLink size={16} />}
                        <span>{isLaunching ? '正在打开...' : copy.buttonLabel}</span>
                    </button>
                </div>

                {launchError ? <p className={styles.caption}>{launchError}</p> : null}
                <p className={styles.caption}>{siteMeta.defaultAppUrl}</p>
            </main>
        </div>
    );
}
