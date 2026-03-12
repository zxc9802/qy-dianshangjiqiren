'use client';

import { create } from 'zustand';
import { api, type AttachmentInfo, type ConversationDetail, type ConversationInfo } from '../lib/api';

export interface ConversationMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    kind?: 'text' | 'image';
    imageUrls?: string[];
    imagePrompt?: string;
    aspectRatio?: string;
    attachments?: AttachmentInfo[];
}

export interface Conversation {
    id: string;
    botId: string;
    botName: string;
    botKind: 'builtin' | 'custom';
    botRefId: string;
    title: string;
    messages: ConversationMessage[];
    messageCount: number;
    isFavorite: boolean;
    createdAt: number;
    updatedAt: number;
}

interface ConversationsState {
    conversations: Conversation[];
    favorites: Conversation[];
    isLoading: boolean;
    hasLoaded: boolean;
    loadConversations: () => Promise<void>;
    fetchConversation: (id: string) => Promise<Conversation>;
    createConversation: (botId: string) => Promise<Conversation>;
    deleteConversation: (id: string) => Promise<void>;
    toggleFavorite: (id: string) => Promise<void>;
    removeFavorite: (id: string) => Promise<void>;
    getConversation: (id: string) => Conversation | undefined;
}

function normalizeConversationMessage(
    message: {
        id: string;
        role: string;
        content: string;
        createdAt?: string;
        kind?: 'text' | 'image';
        imageUrls?: string[];
        imagePrompt?: string;
        aspectRatio?: string;
        attachments?: AttachmentInfo[];
    },
): ConversationMessage {
    return {
        id: message.id,
        role: message.role === 'user' ? 'user' : 'assistant',
        content: message.content,
        timestamp: message.createdAt ? new Date(message.createdAt).getTime() : Date.now(),
        kind: message.kind,
        imageUrls: message.imageUrls,
        imagePrompt: message.imagePrompt,
        aspectRatio: message.aspectRatio,
        attachments: message.attachments,
    };
}

function normalizeConversation(input: ConversationInfo | ConversationDetail): Conversation {
    return {
        id: input.id,
        botId: input.bot.routeId,
        botName: input.bot.name,
        botKind: input.bot.kind,
        botRefId: input.bot.refId,
        title: input.title,
        messages: (input.messages || []).map(normalizeConversationMessage),
        messageCount: input.messageCount ?? input.messages?.length ?? 0,
        isFavorite: input.isFavorited,
        createdAt: new Date(input.createdAt).getTime(),
        updatedAt: new Date(input.updatedAt).getTime(),
    };
}

function sortConversations(list: Conversation[]): Conversation[] {
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

function syncConversationLists(list: Conversation[]) {
    const conversations = sortConversations(list);
    const favorites = conversations.filter((item) => item.isFavorite);
    return { conversations, favorites };
}

function upsertConversation(list: Conversation[], nextConversation: Conversation): Conversation[] {
    const index = list.findIndex((item) => item.id === nextConversation.id);
    if (index === -1) {
        return [nextConversation, ...list];
    }
    const nextList = [...list];
    nextList[index] = nextConversation;
    return nextList;
}

export const useConversationsStore = create<ConversationsState>((set, get) => ({
    conversations: [],
    favorites: [],
    isLoading: false,
    hasLoaded: false,

    loadConversations: async () => {
        set({ isLoading: true });
        try {
            const limit = 50;
            let page = 1;
            let total = 0;
            const items: Conversation[] = [];

            do {
                const response = await api.getConversations({ page, limit });
                total = response.data.total;
                items.push(...response.data.conversations.map(normalizeConversation));
                page += 1;
            } while (items.length < total);

            set({
                ...syncConversationLists(items),
                isLoading: false,
                hasLoaded: true,
            });
        } catch (error) {
            console.error('[Conversations] Failed to load conversations', error);
            set({ isLoading: false });
            throw error;
        }
    },

    fetchConversation: async (id) => {
        const response = await api.getConversation(id);
        const conversation = normalizeConversation(response.data);

        set((state) => ({
            ...syncConversationLists(upsertConversation(state.conversations, conversation)),
            hasLoaded: true,
        }));

        return conversation;
    },

    createConversation: async (botId) => {
        const response = await api.createConversation(botId);
        const conversation = normalizeConversation(response.data);

        set((state) => ({
            ...syncConversationLists(upsertConversation(state.conversations, conversation)),
            hasLoaded: true,
        }));

        return conversation;
    },

    deleteConversation: async (id) => {
        await api.deleteConversation(id);

        set((state) => ({
            ...syncConversationLists(state.conversations.filter((item) => item.id !== id)),
        }));
    },

    toggleFavorite: async (id) => {
        const response = await api.toggleFavorite(id);
        const target = get().conversations.find((item) => item.id === id);
        if (!target) return;

        const updatedConversation: Conversation = {
            ...target,
            isFavorite: response.data.isFavorited,
            updatedAt: Date.now(),
        };

        set((state) => ({
            ...syncConversationLists(upsertConversation(state.conversations, updatedConversation)),
        }));
    },

    removeFavorite: async (id) => {
        const target = get().conversations.find((item) => item.id === id);
        if (!target?.isFavorite) return;
        await get().toggleFavorite(id);
    },

    getConversation: (id) => get().conversations.find((item) => item.id === id),
}));
