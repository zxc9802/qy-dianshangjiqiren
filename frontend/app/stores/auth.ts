import { create } from 'zustand';
import { api, UserInfo } from '../lib/api';
import { runLocalDataMigration } from '../lib/local-data-migration';

interface AuthState {
    user: UserInfo | null;
    token: string | null;
    isLoading: boolean;
    isAuthenticated: boolean;

    login: (account: string, password: string) => Promise<void>;
    register: (account: string, password: string, inviteCode: string, nickname: string, groupName: string) => Promise<void>;
    logout: () => void;
    loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
    isLoading: true,
    isAuthenticated: false,

    login: async (account, password) => {
        const res = await api.login({ account, password });
        const { token, user } = res.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        try {
            await runLocalDataMigration(user.id);
        } catch (error) {
            console.error('[Migration] Failed after login', error);
        }
        set({ user, token, isAuthenticated: true });
    },

    register: async (account, password, inviteCode, nickname, groupName) => {
        const res = await api.register({ account, password, inviteCode, nickname, groupName });
        const { token, user } = res.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        try {
            await runLocalDataMigration(user.id);
        } catch (error) {
            console.error('[Migration] Failed after register', error);
        }
        set({ user, token, isAuthenticated: true });
    },

    logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        set({ user: null, token: null, isAuthenticated: false });
        window.location.href = '/login';
    },

    loadUser: async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            set({ isLoading: false, isAuthenticated: false });
            return;
        }
        try {
            const res = await api.getMe();
            const user = res.data;
            try {
                await runLocalDataMigration(user.id);
            } catch (error) {
                console.error('[Migration] Failed during user load', error);
            }
            localStorage.setItem('user', JSON.stringify(user));
            set({ user, token, isAuthenticated: true, isLoading: false });
        } catch {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            set({ isLoading: false, isAuthenticated: false });
        }
    },
}));
