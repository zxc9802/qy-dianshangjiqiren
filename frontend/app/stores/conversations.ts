'use client';

import { create } from 'zustand';

export interface ConversationMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export interface Conversation {
    id: string;
    botId: string;
    botName: string;
    messages: ConversationMessage[];
    isFavorite: boolean;
    createdAt: number;
    updatedAt: number;
}

interface ConversationsState {
    conversations: Conversation[];
    favorites: Conversation[];
    loadConversations: () => void;
    saveConversation: (conv: Conversation) => void;
    deleteConversation: (id: string) => void;
    toggleFavorite: (id: string) => void;
    removeFavorite: (id: string) => void;
    getConversation: (id: string) => Conversation | undefined;
}

const CONV_KEY = 'conversations';
const FAV_KEY = 'favorites';

function loadList(key: string): Conversation[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveList(key: string, list: Conversation[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(list));
}

export const useConversationsStore = create<ConversationsState>((set, get) => ({
    conversations: [],
    favorites: [],

    loadConversations: () => {
        set({
            conversations: loadList(CONV_KEY),
            favorites: loadList(FAV_KEY),
        });
    },

    saveConversation: (conv) => {
        const list = get().conversations;
        const idx = list.findIndex(c => c.id === conv.id);
        let updated: Conversation[];
        if (idx >= 0) {
            updated = [...list];
            updated[idx] = conv;
        } else {
            updated = [conv, ...list];
        }
        saveList(CONV_KEY, updated);
        set({ conversations: updated });

        // Also update in favorites if it exists there
        const favs = get().favorites;
        const favIdx = favs.findIndex(f => f.id === conv.id);
        if (favIdx >= 0) {
            const updatedFavs = [...favs];
            updatedFavs[favIdx] = { ...conv, isFavorite: true };
            saveList(FAV_KEY, updatedFavs);
            set({ favorites: updatedFavs });
        }
    },

    deleteConversation: (id) => {
        // Only delete from history, favorites stay
        const updated = get().conversations.filter(c => c.id !== id);
        saveList(CONV_KEY, updated);
        set({ conversations: updated });
    },

    toggleFavorite: (id) => {
        const list = get().conversations;
        const conv = list.find(c => c.id === id);
        const favs = get().favorites;
        const isCurrentlyFav = favs.some(f => f.id === id);

        if (isCurrentlyFav) {
            // Remove from favorites
            const updatedFavs = favs.filter(f => f.id !== id);
            saveList(FAV_KEY, updatedFavs);
            // Update flag in conversations
            const updatedConvs = list.map(c =>
                c.id === id ? { ...c, isFavorite: false } : c
            );
            saveList(CONV_KEY, updatedConvs);
            set({ favorites: updatedFavs, conversations: updatedConvs });
        } else if (conv) {
            // Add to favorites (copy the conversation)
            const favConv = { ...conv, isFavorite: true };
            const updatedFavs = [favConv, ...favs];
            saveList(FAV_KEY, updatedFavs);
            // Update flag in conversations
            const updatedConvs = list.map(c =>
                c.id === id ? { ...c, isFavorite: true } : c
            );
            saveList(CONV_KEY, updatedConvs);
            set({ favorites: updatedFavs, conversations: updatedConvs });
        }
    },

    removeFavorite: (id) => {
        const updatedFavs = get().favorites.filter(f => f.id !== id);
        saveList(FAV_KEY, updatedFavs);
        // Also update flag in conversations if it still exists
        const updatedConvs = get().conversations.map(c =>
            c.id === id ? { ...c, isFavorite: false } : c
        );
        saveList(CONV_KEY, updatedConvs);
        set({ favorites: updatedFavs, conversations: updatedConvs });
    },

    getConversation: (id) => {
        // Check favorites first (in case deleted from history)
        const fav = get().favorites.find(f => f.id === id);
        if (fav) return fav;
        return get().conversations.find(c => c.id === id);
    },
}));
