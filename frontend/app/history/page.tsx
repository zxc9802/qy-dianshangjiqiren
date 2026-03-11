'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/auth';
import { BUILTIN_BOT_NAME_MAP } from '../lib/builtin-bots';
import { useConversationsStore, Conversation } from '../stores/conversations';
import styles from './history.module.css';

const BOT_NAMES = BUILTIN_BOT_NAME_MAP;

type FilterTab = 'all' | 'favorites';

export default function HistoryPage() {
    const router = useRouter();
    const { user } = useAuthStore();
    const { conversations, loadConversations, deleteConversation, toggleFavorite } = useConversationsStore();
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState<FilterTab>('all');

    useEffect(() => {
        void loadConversations().catch((error) => {
            console.error('[History] Failed to load conversations', error);
        });
    }, [loadConversations]);

    useEffect(() => {
        if (!user && typeof window !== 'undefined') {
            const stored = localStorage.getItem('user');
            if (!stored) router.push('/login');
        }
    }, [user, router]);

    const filtered = conversations
        .filter(c => {
            if (tab === 'favorites' && !c.isFavorite) return false;
            if (search) {
                const q = search.toLowerCase();
                const name = (BOT_NAMES[c.botId] || c.botName || '').toLowerCase();
                const lastMsg = c.messages[c.messages.length - 1]?.content?.toLowerCase() || '';
                return name.includes(q) || lastMsg.includes(q);
            }
            return true;
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);

    const formatTime = (ts: number) => {
        const d = new Date(ts);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return '刚刚';
        if (diffMin < 60) return `${diffMin}分钟前`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}小时前`;
        const diffDay = Math.floor(diffHr / 24);
        if (diffDay < 7) return `${diffDay}天前`;
        return `${d.getMonth() + 1}/${d.getDate()}`;
    };

    const getPreview = (conv: Conversation) => {
        const lastMsg = conv.messages[conv.messages.length - 1];
        if (!lastMsg) return '暂无消息';
        const text = lastMsg.content.replace(/\n/g, ' ').replace(/\*\*/g, '');
        return text.length > 60 ? text.slice(0, 60) + '...' : text;
    };

    const handleDelete = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm('确定删除这条对话吗？')) {
            void deleteConversation(id);
        }
    };

    const handleFavorite = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        void toggleFavorite(id);
    };

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <button className={styles.backBtn} onClick={() => router.push('/')}>
                    ← 返回
                </button>
                <h1 className={styles.title}>对话历史</h1>
                <div className={styles.headerRight} />
            </header>

            <div className={styles.toolbar}>
                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${tab === 'all' ? styles.tabActive : ''}`}
                        onClick={() => setTab('all')}
                    >
                        全部 ({conversations.length})
                    </button>
                    <button
                        className={`${styles.tab} ${tab === 'favorites' ? styles.tabActive : ''}`}
                        onClick={() => setTab('favorites')}
                    >
                        收藏 ({conversations.filter(c => c.isFavorite).length})
                    </button>
                </div>
                <input
                    className={styles.searchInput}
                    type="text"
                    placeholder="搜索对话..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            <div className={styles.list}>
                {filtered.length === 0 ? (
                    <div className={styles.empty}>
                        <p className={styles.emptyText}>
                            {search ? '没有找到匹配的对话' : tab === 'favorites' ? '暂无收藏对话' : '暂无对话历史'}
                        </p>
                        {!search && tab === 'all' && (
                            <button className={styles.startBtn} onClick={() => router.push('/')}>
                                开始新对话
                            </button>
                        )}
                    </div>
                ) : (
                    filtered.map(conv => (
                        <div
                            key={conv.id}
                            className={styles.card}
                            onClick={() => router.push(`/chat/${conv.botId}?cid=${conv.id}`)}
                        >
                            <div className={styles.cardHeader}>
                                <span className={styles.botName}>
                                    {BOT_NAMES[conv.botId] || conv.botName}
                                </span>
                                <span className={styles.time}>{formatTime(conv.updatedAt)}</span>
                            </div>
                            <p className={styles.preview}>{getPreview(conv)}</p>
                            <div className={styles.cardFooter}>
                                <span className={styles.msgCount}>
                                    {conv.messageCount} 条消息
                                </span>
                                <div className={styles.actions}>
                                    <button
                                        className={`${styles.actionBtn} ${conv.isFavorite ? styles.favorited : ''}`}
                                        onClick={e => handleFavorite(e, conv.id)}
                                        title={conv.isFavorite ? '取消收藏' : '收藏'}
                                    >
                                        {conv.isFavorite ? '★' : '☆'}
                                    </button>
                                    <button
                                        className={styles.actionBtn}
                                        onClick={e => handleDelete(e, conv.id)}
                                        title="删除"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
