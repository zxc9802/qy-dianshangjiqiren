'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../stores/auth';
import { VideoForgeStudio } from './VideoForgeStudio';

export default function VideoGeneratorBotPage() {
    const router = useRouter();
    const { isAuthenticated, isLoading, loadUser } = useAuthStore();

    useEffect(() => {
        void loadUser();
    }, [loadUser]);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.replace('/login');
        }
    }, [isAuthenticated, isLoading, router]);

    if (isLoading || !isAuthenticated) {
        return null;
    }

    return <VideoForgeStudio />;
}
