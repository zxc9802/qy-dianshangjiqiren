import { create } from 'zustand';
import { api, UserInfo } from '../lib/api';

interface AuthState {
    user: UserInfo | null;
    token: string | null;
    isLoading: boolean;
    isAuthenticated: boolean;

    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string, code: string, nickname?: string) => Promise<void>;
    sendCode: (email: string) => Promise<void>;
    verifyCode: (email: string, code: string) => Promise<void>;
    logout: () => void;
    loadUser: () => Promise<void>;
    updatePoints: (balance: number) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
    isLoading: true,
    isAuthenticated: false,

    login: async (email, password) => {
        const res = await api.login({ email, password });
        const { token, user } = res.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        set({ user, token, isAuthenticated: true });
    },

    register: async (email, password, code, nickname) => {
        const res = await api.register({ email, password, code, nickname });
        const { token, user } = res.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        set({ user, token, isAuthenticated: true });
    },

    sendCode: async (email) => {
        await api.sendCode({ email });
    },

    verifyCode: async (email, code) => {
        await api.verifyCode({ email, code });
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
            localStorage.setItem('user', JSON.stringify(user));
            set({ user, token, isAuthenticated: true, isLoading: false });
        } catch {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            set({ isLoading: false, isAuthenticated: false });
        }
    },

    updatePoints: (balance) => {
        set((state) => {
            const newUser = state.user ? { ...state.user, pointsBalance: balance } : null;
            if (newUser) localStorage.setItem('user', JSON.stringify(newUser));
            return { user: newUser };
        });
    },
}));
