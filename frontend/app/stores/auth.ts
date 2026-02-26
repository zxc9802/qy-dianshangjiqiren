import { create } from 'zustand';

interface UserInfo {
    id: string;
    phone: string;
    nickname: string;
    avatar: string;
    pointsBalance: number;
}

interface AuthState {
    user: UserInfo | null;
    token: string | null;
    isLoading: boolean;
    isAuthenticated: boolean;

    login: (phone: string, password: string) => Promise<void>;
    register: (phone: string, password: string, nickname?: string) => Promise<void>;
    logout: () => void;
    loadUser: () => Promise<void>;
    updatePoints: (balance: number) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
    isLoading: true,
    isAuthenticated: false,

    login: async (phone, _password) => {
        // Mock login - no backend needed
        const user: UserInfo = {
            id: 'mock-user-001',
            phone,
            nickname: `用户${phone.slice(-4)}`,
            avatar: '',
            pointsBalance: 500,
        };
        const token = 'mock-token-' + Date.now();
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        set({ user, token, isAuthenticated: true });
    },

    register: async (phone, _password, nickname) => {
        // Mock register
        const user: UserInfo = {
            id: 'mock-user-001',
            phone,
            nickname: nickname || `用户${phone.slice(-4)}`,
            avatar: '',
            pointsBalance: 500,
        };
        const token = 'mock-token-' + Date.now();
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
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
        const userStr = localStorage.getItem('user');
        if (token && userStr) {
            try {
                const user = JSON.parse(userStr);
                set({ user, token, isAuthenticated: true, isLoading: false });
                return;
            } catch { /* ignore */ }
        }
        set({ isLoading: false, isAuthenticated: false });
    },

    updatePoints: (balance) => {
        set((state) => {
            const newUser = state.user ? { ...state.user, pointsBalance: balance } : null;
            if (newUser) localStorage.setItem('user', JSON.stringify(newUser));
            return { user: newUser };
        });
    },
}));
