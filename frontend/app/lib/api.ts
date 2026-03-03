const API_BASE = '/api';

export function resolveImageAssetUrl(input: string): string {
    return input || '';
}

function getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('token');
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = getToken();
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

    const headers: Record<string, string> = {
        ...((options.headers || {}) as Record<string, string>),
    };
    if (!isFormData) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
        ? await res.json()
        : await res.text();

    if (!res.ok) {
        if (res.status === 401 && typeof window !== 'undefined') {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
        }
        const message = typeof data === 'string'
            ? data
            : data?.message || data?.error || 'Request failed';
        throw new Error(message);
    }

    return data as T;
}

export const api = {
    // Auth
    sendCode: (body: { email: string }) =>
        request<{ success: boolean; message: string }>('/auth?action=send-code', { method: 'POST', body: JSON.stringify(body) }),

    verifyCode: (body: { email: string; code: string }) =>
        request<{ success: boolean; message: string }>('/auth?action=verify-code', { method: 'POST', body: JSON.stringify(body) }),

    register: (body: { email: string; password: string; code: string; nickname?: string; inviteCode?: string }) =>
        request<{ success: boolean; data: { token: string; user: UserInfo } }>('/auth?action=register', { method: 'POST', body: JSON.stringify(body) }),

    login: (body: { email: string; password: string }) =>
        request<{ success: boolean; data: { token: string; user: UserInfo } }>('/auth?action=login', { method: 'POST', body: JSON.stringify(body) }),

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
        request<{ success: boolean; data: { isFavorited: boolean } }>(`/conversations/${id}`, { method: 'PATCH' }),

    deleteConversation: (id: string) =>
        request<{ success: boolean }>(`/conversations/${id}`, { method: 'DELETE' }),

    // Points
    getBalance: () => request<{ success: boolean; data: { balance: number } }>('/points?action=balance'),
    getTransactions: (params?: { page?: number; type?: string }) => {
        const qs = new URLSearchParams(params as unknown as Record<string, string>).toString();
        return request<{ success: boolean; data: { transactions: PointsTransaction[]; total: number } }>(`/points${qs ? `?${qs}` : ''}`);
    },
    redeem: (code: string) =>
        request<{ success: boolean; data: { pointsAdded: number; newBalance: number } }>('/points?action=redeem', { method: 'POST', body: JSON.stringify({ code }) }),
    recharge: (amount: number) =>
        request<{ success: boolean; data: { pointsAdded: number; newBalance: number } }>('/points?action=recharge', { method: 'POST', body: JSON.stringify({ amount }) }),

    // Image generations
    generateImage: (body: Record<string, unknown>) =>
        request<{ success: boolean; data: ImageGenerationItem }>('/image-generations', { method: 'POST', body: JSON.stringify(body) }),

    getImageGenerations: (params?: { cursor?: string; limit?: number }) => {
        const query: Record<string, string> = {};
        if (params?.cursor) query.cursor = params.cursor;
        if (typeof params?.limit === 'number') query.limit = String(params.limit);
        const qs = new URLSearchParams(query).toString();
        return request<{ success: boolean; data: ImageGenerationListResponse }>(`/image-generations${qs ? `?${qs}` : ''}`);
    },

    getImageGeneration: (id: string) =>
        request<{ success: boolean; data: ImageGenerationItem }>(`/image-generations/${id}`),

    deleteImageGeneration: (id: string) =>
        request<{ success: boolean }>(`/image-generations/${id}`, { method: 'DELETE' }),

    // Image prompt custom tags
    getImagePromptTags: () =>
        request<{ success: boolean; data: ImagePromptTagGroupResponse }>('/image-prompt-tags'),

    createImagePromptTag: (body: CreateImagePromptTagRequest) =>
        request<{ success: boolean; data: ImagePromptTagItem }>('/image-prompt-tags', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    deleteImagePromptTag: (id: string) =>
        request<{ success: boolean; message?: string }>(`/image-prompt-tags/${id}`, { method: 'DELETE' }),

    // SSE streaming (returns EventSource URL)
    getMessageStreamUrl: (conversationId: string) => `/api/conversations/${conversationId}/messages`,
};

// Types
export interface UserInfo {
    id: string;
    email: string;
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

export interface ImageGenerationRequest {
    prompt: string;
    negativePrompt?: string;
    aspectRatio?: string;
    stylePreset?: string;
    background?: string;
    lighting?: string;
    referenceStrength?: number;
    count?: number;
}

export interface ImageGenerationItem {
    id: string;
    userId: string;
    prompt: string;
    negativePrompt: string | null;
    aspectRatio: string;
    imageSize: string;
    stylePreset: string | null;
    background: string | null;
    lighting: string | null;
    referenceStrength: number;
    count: number;
    referenceImagePath: string | null;
    resultImagePaths: string[];
    status: 'success' | 'partial' | 'failed' | string;
    errorMessage: string | null;
    createdAt: string;
}

export interface ImageGenerationListResponse {
    items: ImageGenerationItem[];
    nextCursor: string | null;
}

export interface ImagePromptTagItem {
    id: string;
    userId: string;
    groupKey: string;
    label: string;
    createdAt: string;
}

export interface ImagePromptTagGroupResponse {
    items: ImagePromptTagItem[];
    grouped: Record<string, string[]>;
}

export interface CreateImagePromptTagRequest {
    groupKey: string;
    label: string;
}
