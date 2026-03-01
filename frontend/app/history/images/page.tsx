'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ImageGenerationItem, resolveImageAssetUrl } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { PROMPT_LIBRARY_GROUPS } from '../../components/imagePromptLibrary';
import styles from './page.module.css';

const DRAFT_KEY = 'image_studio_draft_v2';
const ASPECT_RATIOS = ['1:1', '4:5', '3:4', '16:9', '9:16'];
const STYLE_PRESETS = ['电商清透', '高级时尚', '生活场景', '高反差冲击', '极简高级'];
const BACKGROUNDS = ['纯白背景', '浅灰背景', '柔和渐变', '暖色氛围', '场景化背景'];
const LIGHTING_OPTIONS = ['棚拍柔光', '自然窗光', '高对比硬光', '逆光氛围', '俯拍清晰光'];

function formatTime(input: string): string {
    const date = new Date(input);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function statusLabel(status: string): string {
    if (status === 'success') return '成功';
    if (status === 'partial') return '部分成功';
    if (status === 'failed') return '失败';
    return status;
}

function uniqueTags(tags: string[]): string[] {
    return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

function trimPunctuation(input: string): string {
    return input.trim().replace(/[，,。；;、\s]+$/g, '');
}

function stripTrailingAutoClause(input: string, autoClause: string): string {
    const value = input.replace(/\r\n/g, '\n').trim();
    const clause = autoClause.trim();
    if (!clause) return value;
    if (!value.endsWith(clause)) return value;
    return trimPunctuation(value.slice(0, value.length - clause.length));
}

export default function ImageHistoryPage() {
    const router = useRouter();
    const { isAuthenticated, isLoading, loadUser } = useAuthStore();

    const [items, setItems] = useState<ImageGenerationItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [isLoadingList, setIsLoadingList] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadUser();
    }, [loadUser]);

    const fetchList = async (cursor?: string) => {
        setIsLoadingList(true);
        setError(null);
        try {
            const response = await api.getImageGenerations({ cursor, limit: 20 });
            if (cursor) {
                setItems((prev) => [...prev, ...response.data.items]);
            } else {
                setItems(response.data.items);
            }
            setNextCursor(response.data.nextCursor);
        } catch (err) {
            setError(err instanceof Error ? err.message : '加载历史失败');
        } finally {
            setIsLoadingList(false);
        }
    };

    useEffect(() => {
        if (isLoading) return;
        if (!isAuthenticated) {
            router.push('/login');
            return;
        }
        fetchList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, isLoading]);

    const deleteItem = async (id: string) => {
        if (!confirm('确定删除这条生成记录吗？')) return;
        try {
            await api.deleteImageGeneration(id);
            setItems((prev) => prev.filter((item) => item.id !== id));
        } catch (err) {
            alert(err instanceof Error ? err.message : '删除失败');
        }
    };

    const reuse = (item: ImageGenerationItem) => {
        const allDefaultTags = PROMPT_LIBRARY_GROUPS.flatMap((group) => group.tags);
        const inferredTags = uniqueTags(allDefaultTags.filter((tag) => item.prompt.includes(tag)));
        const inferredAutoTokens = uniqueTags([
            ...inferredTags,
            item.aspectRatio || '',
            item.stylePreset || '',
            item.background || '',
            item.lighting || '',
        ]);
        const inferredAutoClause = inferredAutoTokens.join('，');
        const aspectRatio = ASPECT_RATIOS.includes(item.aspectRatio) ? item.aspectRatio : '1:1';
        const stylePreset = item.stylePreset && STYLE_PRESETS.includes(item.stylePreset) ? item.stylePreset : '电商清透';
        const background = item.background && BACKGROUNDS.includes(item.background) ? item.background : '纯白背景';
        const lighting = item.lighting && LIGHTING_OPTIONS.includes(item.lighting) ? item.lighting : '棚拍柔光';
        const selectedTags = uniqueTags([...inferredTags, aspectRatio, stylePreset, background, lighting]);

        const draft = {
            manualPrompt: stripTrailingAutoClause(item.prompt, inferredAutoClause),
            selectedTags,
            negativePrompt: item.negativePrompt || '',
            aspectRatio,
            stylePreset,
            background,
            lighting,
            referenceStrength: item.referenceStrength || 50,
            count: item.count || 1,
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        router.push('/bot/image-generator');
    };

    if (isLoading || (!isAuthenticated && typeof window !== 'undefined')) {
        return <div className={styles.loading}>加载中...</div>;
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <button className={styles.backBtn} onClick={() => router.push('/bot/image-generator')}>返回</button>
                <h1>图片生成历史</h1>
                <div className={styles.headerActions}>
                    <button className={styles.secondaryBtn} onClick={() => fetchList()}>刷新</button>
                </div>
            </header>

            {error && <p className={styles.error}>{error}</p>}
            {!error && items.length === 0 && !isLoadingList && <p className={styles.empty}>暂无生成记录。</p>}

            <div className={styles.grid}>
                {items.map((item) => (
                    <article key={item.id} className={styles.card}>
                        <div className={styles.previewGrid}>
                            {item.resultImagePaths.length ? (
                                item.resultImagePaths.map((image) => (
                                    <a key={image} href={resolveImageAssetUrl(image)} target="_blank" rel="noreferrer" className={styles.previewItem}>
                                        <img src={resolveImageAssetUrl(image)} alt="生成预览图" loading="lazy" />
                                    </a>
                                ))
                            ) : (
                                <div className={styles.previewEmpty}>无图片结果</div>
                            )}
                        </div>

                        <div className={styles.meta}>
                            <p className={styles.prompt}>{item.prompt}</p>
                            <p className={styles.row}>时间：{formatTime(item.createdAt)}</p>
                            <p className={styles.row}>状态：{statusLabel(item.status)}</p>
                            <p className={styles.row}>比例：{item.aspectRatio} · 数量：{item.count} · 清晰度：{item.imageSize}</p>
                            {item.errorMessage && <p className={styles.errorInline}>{item.errorMessage}</p>}
                        </div>

                        <div className={styles.actions}>
                            <button className={styles.secondaryBtn} onClick={() => navigator.clipboard.writeText(item.prompt)}>复制提示词</button>
                            <button className={styles.secondaryBtn} onClick={() => reuse(item)}>复用</button>
                            <button className={styles.dangerBtn} onClick={() => deleteItem(item.id)}>删除</button>
                        </div>
                    </article>
                ))}
            </div>

            {nextCursor && (
                <div className={styles.loadMoreWrap}>
                    <button className={styles.secondaryBtn} disabled={isLoadingList} onClick={() => fetchList(nextCursor)}>
                        {isLoadingList ? '加载中...' : '加载更多'}
                    </button>
                </div>
            )}
        </div>
    );
}
