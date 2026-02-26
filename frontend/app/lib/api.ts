const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

function getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('token');
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = getToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers || {}) as Record<string, string>),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
    const data = await res.json();

    if (!res.ok) {
        if (res.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
        }
        throw new Error(data.message || '请求失败');
    }

    return data;
}

export const api = {
    // Auth
    register: (body: { phone: string; password: string; nickname?: string; inviteCode?: string }) =>
        request<{ success: boolean; data: { token: string; user: UserInfo } }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),

    login: (body: { phone: string; password: string }) =>
        request<{ success: boolean; data: { token: string; user: UserInfo } }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

    getMe: () => request<{ success: boolean; data: UserInfo }>('/auth/me'),

    // Bots
    getBots: (params?: { category?: string; search?: string }) => {
        const qs = new URLSearchParams(params as Record<string, string>).toString();
        return request<{ success: boolean; data: BotInfo[] }>(`/bots${qs ? `?${qs}` : ''}`);
    },
    getBot: (id: string) => request<{ success: boolean; data: BotInfo }>(`/bots/${id}`),
    getCategories: () => request<{ success: boolean; data: string[] }>('/bots/categories'),

    // Conversations
    createConversation: (botId: string) =>
        request<{ success: boolean; data: ConversationInfo }>('/conversations', { method: 'POST', body: JSON.stringify({ botId }) }),

    getConversations: (params?: { page?: number; limit?: number; botId?: string; favorited?: boolean }) => {
        const qs = new URLSearchParams(params as unknown as Record<string, string>).toString();
        return request<{ success: boolean; data: { conversations: ConversationInfo[]; total: number } }>(`/conversations${qs ? `?${qs}` : ''}`);
    },

    getConversation: (id: string) =>
        request<{ success: boolean; data: ConversationDetail }>(`/conversations/${id}`),

    toggleFavorite: (id: string) =>
        request<{ success: boolean; data: { isFavorited: boolean } }>(`/conversations/${id}/favorite`, { method: 'PATCH' }),

    deleteConversation: (id: string) =>
        request<{ success: boolean }>(`/conversations/${id}`, { method: 'DELETE' }),

    // Points
    getBalance: () => request<{ success: boolean; data: { balance: number } }>('/points/balance'),
    getTransactions: (params?: { page?: number; type?: string }) => {
        const qs = new URLSearchParams(params as unknown as Record<string, string>).toString();
        return request<{ success: boolean; data: { transactions: PointsTransaction[]; total: number } }>(`/points/transactions${qs ? `?${qs}` : ''}`);
    },
    redeem: (code: string) =>
        request<{ success: boolean; data: { pointsAdded: number; newBalance: number } }>('/points/redeem', { method: 'POST', body: JSON.stringify({ code }) }),
    recharge: (amount: number) =>
        request<{ success: boolean; data: { pointsAdded: number; newBalance: number } }>('/points/recharge', { method: 'POST', body: JSON.stringify({ amount }) }),

    // SSE streaming (returns EventSource URL)
    getMessageStreamUrl: (conversationId: string) => `${API_BASE}/conversations/${conversationId}/messages`,
};

// Types
export interface UserInfo {
    id: string;
    phone: string;
    nickname: string;
    avatar: string;
    pointsBalance: number;
    createdAt?: string;
}

export interface BotInfo {
    id: string;
    name: string;
    slug: string;
    category: string;
    icon: string;
    description: string;
    pointsPerUse: number;
}

export interface ConversationInfo {
    id: string;
    botId: string;
    title: string;
    isFavorited: boolean;
    createdAt: string;
    updatedAt: string;
    bot: { name: string; icon: string; category: string };
    messages?: { content: string; createdAt: string }[];
}

export interface ConversationDetail extends ConversationInfo {
    bot: { id: string; name: string; icon: string; category: string; pointsPerUse: number };
    messages: MessageInfo[];
}

export interface MessageInfo {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    inputType: string;
    suggestions: string | null;
    createdAt: string;
    attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
    id: string;
    fileType: string;
    fileUrl: string;
    fileName: string;
    fileSize: number;
}

export interface PointsTransaction {
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string;
    createdAt: string;
}
