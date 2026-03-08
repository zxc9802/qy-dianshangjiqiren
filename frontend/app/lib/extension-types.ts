export type ExtensionBotKind = 'builtin' | 'custom';
export type ExtensionChatMode = 'summary' | 'chat';
export type TranscriptSource = 'dom' | 'track' | 'page' | 'none';

export interface ExtensionChatMessage {
    role: 'user' | 'assistant';
    content: string;
    createdAt?: string;
}

export interface ExtensionBot {
    botId: string;
    kind: ExtensionBotKind;
    name: string;
    description: string;
    icon: string;
    category: string;
    pointsPerUse: number;
}

export interface PageContext {
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
    transcriptSource: TranscriptSource;
}

export interface ExtensionSessionUser {
    id: string;
    account: string;
    nickname: string;
    avatar: string;
    role?: 'admin' | 'member';
}

export interface ExtensionSessionData {
    user: ExtensionSessionUser;
    siteBaseUrl: string;
}

export interface PageInsightRecord {
    id: string;
    sourceUrl: string;
    sourceTitle: string;
    sourceDomain: string;
    summary: string | null;
    botId: string;
    botKind: ExtensionBotKind;
    botName: string;
    createdAt: string;
    updatedAt: string;
    pageContext: PageContext;
    chatTranscript: ExtensionChatMessage[];
}

export interface LocalPageSession {
    sessionKey: string;
    tabId: number;
    pageUrl: string;
    pageTitle: string;
    pageContext: PageContext;
    contextSnapshot: PageContext | null;
    hasPendingContext: boolean;
    botId: string;
    summary: string;
    messages: ExtensionChatMessage[];
    savedInsightId?: string;
    updatedAt: string;
}
