'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import VideoStudio from '../../components/VideoStudio';
import { useAuthStore } from '../../stores/auth';
import styles from './page.module.css';

export default function VideoGeneratorBotPage() {
    const router = useRouter();
    const { isAuthenticated, loadUser } = useAuthStore();

    useEffect(() => {
        loadUser();
    }, [loadUser]);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <button className={styles.backBtn} onClick={() => router.push('/')}>返回首页</button>
                <div className={styles.headInfo}>
                    <h1>视频生成机器人</h1>
                    <p>
                        把已烟测过的云雾视频接口集中到同一个页面里，
                        可以切换家族、调整参数、提交任务并查看原始响应。
                    </p>
                </div>
                <button className={styles.homeBtn} onClick={() => router.push('/')}>首页</button>
            </header>

            <VideoStudio
                isAuthenticated={isAuthenticated}
                onRequireLogin={() => router.push('/login')}
            />
        </div>
    );
}
