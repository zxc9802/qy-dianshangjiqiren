const API_BASE = '/api';

export class ApiError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

function isPrivateIpv4Host(hostname: string): boolean {
    const parts = hostname.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
        return false;
    }

    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
}

function isInternalAssetHost(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'localhost' || normalized.endsWith('.internal') || normalized.endsWith('.local')) {
        return true;
    }
    return isPrivateIpv4Host(normalized);
}

export function resolveImageAssetUrl(input: string): string {
    if (!input) return '';

    if (input.startsWith('/api/image-assets/') || input.startsWith('/api/generated-images/')) {
        return input;
    }

    if (input.startsWith('/generated-images/')) {
        return `/api/generated-images/${input.slice('/generated-images/'.length)}`;
    }

    if (/^https?:\/\//i.test(input)) {
        try {
            const url = new URL(input);
            if (url.pathname.startsWith('/api/image-assets/')) {
                if (!isInternalAssetHost(url.hostname)) {
                    return input;
                }
                return `${url.pathname}${url.search}`;
            }
            if (url.pathname.startsWith('/generated-images/')) {
                if (!isInternalAssetHost(url.hostname)) {
                    return input;
                }
                return `/api/generated-images/${url.pathname.slice('/generated-images/'.length)}${url.search}`;
            }
        } catch {
            return input;
        }
    }

    return input;
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
        const code = typeof data === 'string' ? undefined : data?.code;
        throw new ApiError(message, res.status, code);
    }

    return data as T;
}

export const api = {
    // Auth
    register: (body: { account: string; password: string; nickname: string; groupName: string; inviteCode: string }) =>
        request<{ success: boolean; data: { token: string; user: UserInfo } }>('/auth?action=register', { method: 'POST', body: JSON.stringify(body) }),

    login: (body: { account: string; password: string }) =>
        request<{ success: boolean; data: { token: string; user: UserInfo } }>('/auth?action=login', { method: 'POST', body: JSON.stringify(body) }),

    activate: (body: { account: string; password: string; inviteCode: string; nickname?: string; groupName?: string }) =>
        request<{ success: boolean; data: { token: string; user: UserInfo } }>('/auth?action=activate', { method: 'POST', body: JSON.stringify(body) }),

    getMe: () => request<{ success: boolean; data: UserInfo }>('/auth/me'),

    updateProfile: (body: { nickname: string }) =>
        request<{ success: boolean; data: UserInfo }>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),

    // Admin invite codes
    createInviteCodeBatch: (body: { count: number }) =>
        request<{ success: boolean; data: { batch: InviteCodeBatchInfo; codes: InviteCodeInfo[] } }>('/admin/invite-code-batches', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    getInviteCodeBatches: () =>
        request<{ success: boolean; data: InviteCodeBatchInfo[] }>('/admin/invite-code-batches'),

    getInviteCodes: (batchId: string) =>
        request<{ success: boolean; data: InviteCodeInfo[] }>(`/admin/invite-codes?batchId=${encodeURIComponent(batchId)}`),

    updateInviteCodeBatch: (batchId: string, body: { remark: string }) =>
        request<{ success: boolean; data: InviteCodeBatchInfo }>(`/admin/invite-code-batches/${batchId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        }),

    searchInviteCodeUsage: (keyword: string) =>
        request<{ success: boolean; data: InviteCodeUsageInfo[] }>(`/admin/invite-code-usage?keyword=${encodeURIComponent(keyword)}`),

    revokeInviteCodeUsage: (inviteCodeId: string) =>
        request<{ success: boolean }>(`/admin/invite-codes/${inviteCodeId}/revoke`, { method: 'POST' }),

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

    sendConversationMessage: (id: string, body: {
        content: string;
        displayContent?: string;
        inputType?: 'text' | 'voice' | 'file' | 'image';
        aspectRatio?: string;
    }) => {
        const token = getToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return fetch(`${API_BASE}/conversations/${id}/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
    },

    migrateLocalData: (body: {
        conversations: LocalConversationItem[];
        favorites: LocalConversationItem[];
        workflows: LocalWorkflowItem[];
    }) =>
        request<{ success: boolean; data: { migratedConversations: number; migratedWorkflows: number } }>(
            '/migrations/local-data',
            { method: 'POST', body: JSON.stringify(body) },
        ),

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

    // Workflows
    getWorkflows: (params?: { action?: string; scope?: string }) => {
        const qs = new URLSearchParams(params as Record<string, string>).toString();
        return request<{ success: boolean; data: WorkflowInfo[] }>(`/workflows${qs ? `?${qs}` : ''}`);
    },

    getWorkflow: (id: string) =>
        request<{ success: boolean; data: WorkflowInfo }>(`/workflows/${id}`),

    createWorkflow: (body: {
        name: string;
        description?: string;
        canvasData: string;
        clientSourceId?: string;
    }) =>
        request<{ success: boolean; data: WorkflowInfo }>('/workflows', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    updateWorkflow: (id: string, body: {
        name?: string;
        description?: string;
        canvasData?: string;
        triggerType?: string;
        cronExpr?: string | null;
        clientSourceId?: string | null;
    }) =>
        request<{ success: boolean; data: WorkflowInfo }>(`/workflows/${id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        }),

    deleteWorkflow: (id: string) =>
        request<{ success: boolean }>(`/workflows/${id}`, { method: 'DELETE' }),

    // Page insights
    getInsights: (params?: { limit?: number }) => {
        const query: Record<string, string> = {};
        if (typeof params?.limit === 'number') query.limit = String(params.limit);
        const qs = new URLSearchParams(query).toString();
        return request<{ success: boolean; data: PageInsightInfo[] }>(`/insights${qs ? `?${qs}` : ''}`);
    },

    getInsight: (id: string) =>
        request<{ success: boolean; data: PageInsightInfo }>(`/insights/${id}`),

    // SSE streaming (returns EventSource URL)
    getMessageStreamUrl: (conversationId: string) => `/api/conversations/${conversationId}/messages`,
};

// Types
export interface UserInfo {
    id: string;
    account: string;
    nickname: string;
    groupName: string;
    avatar: string;
    role: UserRole;
    createdAt?: string;
}

export type UserRole = 'admin' | 'member';

export interface BotInfo {
    id: string;
    name: string;
    slug: string;
    category: string;
    icon: string;
    description: string;
    pointsPerUse: number;
}

export interface ConversationBotInfo {
    routeId: string;
    kind: 'builtin' | 'custom';
    refId: string;
    name: string;
    icon: string;
    category: string;
    pointsPerUse: number;
    isActive: boolean;
}

export interface ConversationInfo {
    id: string;
    botId: string;
    title: string;
    isFavorited: boolean;
    createdAt: string;
    updatedAt: string;
    bot: ConversationBotInfo;
    messageCount: number;
    messages?: Array<{
        id: string;
        role: string;
        content: string;
        createdAt: string;
        inputType?: string;
        kind?: 'text' | 'image';
        imageUrls?: string[];
        imagePrompt?: string;
        aspectRatio?: string;
    }>;
}

export interface ConversationDetail extends ConversationInfo {
    messages: MessageInfo[];
}

export interface MessageInfo {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    inputType: string;
    suggestions: string | null;
    createdAt: string;
    kind?: 'text' | 'image';
    imageUrls?: string[];
    imagePrompt?: string;
    aspectRatio?: string;
    attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
    id: string;
    fileType: string;
    fileUrl: string;
    fileName: string;
    fileSize: number;
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

export interface WorkflowInfo {
    id: string;
    clientSourceId: string | null;
    userId: string;
    name: string;
    description: string;
    canvasData: string;
    triggerType: string;
    isPreset: boolean;
    isPublished: boolean;
    usageCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface PageContextInfo {
    title: string;
    url: string;
    domain: string;
    mainText: string;
    metaDescription: string;
    selectedText: string;
    hasVideo: boolean;
    videoTitle: string;
    videoDescription: string;
    captionsText: string;
    transcriptSource: 'dom' | 'track' | 'page' | 'none';
}

export interface PageInsightInfo {
    id: string;
    sourceUrl: string;
    sourceTitle: string;
    sourceDomain: string;
    summary: string | null;
    botId: string;
    botKind: 'builtin' | 'custom';
    botName: string;
    createdAt: string;
    updatedAt: string;
    pageContext: PageContextInfo;
    chatTranscript: Array<{
        role: 'user' | 'assistant';
        content: string;
        createdAt?: string;
        kind?: 'text' | 'image';
        imageUrls?: string[];
        imagePrompt?: string;
        aspectRatio?: string;
    }>;
}

export interface LocalConversationMessageItem {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp?: number;
}

export interface LocalConversationItem {
    id: string;
    botId: string;
    botName?: string;
    messages: LocalConversationMessageItem[];
    isFavorite?: boolean;
    createdAt?: number;
    updatedAt?: number;
}

export interface LocalWorkflowItem {
    id: string;
    name: string;
    description?: string;
    steps: Array<{ botId: string; botName: string }>;
    createdAt?: number;
    updatedAt?: number;
}

export interface InviteCodeBatchInfo {
    id: string;
    count: number;
    remark: string;
    createdAt: string;
    createdBy: {
        id: string;
        account: string;
        nickname: string;
    };
    usedCount: number;
    unusedCount: number;
}

export interface InviteCodeInfo {
    id: string;
    code: string;
    createdAt: string;
    usedAt: string | null;
    batchId: string;
    canRevoke: boolean;
    usedBy: {
        id: string;
        account: string;
        nickname: string;
        groupName: string;
    } | null;
}

export interface InviteCodeUsageInfo {
    inviteCodeId: string;
    code: string;
    batchId: string;
    batchCreatedAt: string;
    batchRemark: string;
    usedAt: string | null;
    canRevoke: boolean;
    usedBy: {
        id: string;
        account: string;
        nickname: string;
        groupName: string;
    } | null;
}

