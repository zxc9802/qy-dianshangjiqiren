'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
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
        description: '主站负责校验登录态并签发一次性 SSO ticket，点击后会自动进入视频站。',
        buttonLabel: '打开视频工作台',
    },
};

interface VideoWorkbenchClientProps {
    site: VideoSiteKey;
}

export default function VideoWorkbenchClient({ site }: VideoWorkbenchClientProps) {
    const [isLaunching, setIsLaunching] = useState(false);
    const [launchError, setLaunchError] = useState<string | null>(null);

    const siteMeta = VIDEO_SITE_METADATA[site];
    const copy = useMemo(() => VIDEO_WORKBENCH_COPY[site], [site]);

    async function handleOpenStudio() {
        setLaunchError(null);
        setIsLaunching(true);

        try {
            const result = await api.startVideoSso({ site });
            const targetUrl = result.url || siteMeta.defaultAppUrl;
            window.open(targetUrl, '_blank', 'noopener,noreferrer');
        } catch (error) {
            const message = error instanceof ApiError ? error.message : '打开视频工作台失败';
            setLaunchError(message);
        } finally {
            setIsLaunching(false);
        }
    }

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
