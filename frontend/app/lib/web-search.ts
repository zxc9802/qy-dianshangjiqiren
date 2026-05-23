import { readServerEnv } from './server-env';
import {
    DEFAULT_WEB_SEARCH_MODE,
    type WebSearchMode,
} from './chat-models';
import type { OpenAIChatMessage } from './yunwu-openai-chat';

const DEFAULT_ANYSEARCH_API_URL = 'https://api.anysearch.com/v1/search';
const DEFAULT_MAX_RESULTS = 5;
const MAX_QUERY_CHARS = 500;
const MAX_RESULT_CONTENT_CHARS = 900;

type AnySearchResult = {
    title?: unknown;
    url?: unknown;
    description?: unknown;
    content?: unknown;
};

type AnySearchPayload = {
    code?: unknown;
    message?: unknown;
    data?: {
        results?: AnySearchResult[];
    };
};

export type WebSearchEnrichmentResult = {
    systemPrompt: string;
    usedWebSearch: boolean;
};

function stringifyContent(content: OpenAIChatMessage['content']): string {
    if (typeof content === 'string') {
        return content.trim();
    }

    return content
        .map((part) => part.type === 'text' ? part.text : '')
        .filter(Boolean)
        .join('\n')
        .trim();
}

export function getLatestUserQuery(messages: OpenAIChatMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== 'user') {
            continue;
        }

        const text = stringifyContent(message.content).trim();
        if (text) {
            return text.slice(0, MAX_QUERY_CHARS);
        }
    }

    return '';
}

export function shouldAutoUseWebSearch(query: string): boolean {
    const normalized = query.toLowerCase();
    return [
        '最新',
        '今天',
        '现在',
        '当前',
        '新闻',
        '近期',
        '最近',
        '实时',
        '价格',
        '股价',
        '汇率',
        '天气',
        'today',
        'latest',
        'recent',
        'current',
        'news',
        'price',
        'stock',
        'weather',
    ].some((keyword) => normalized.includes(keyword));
}

function shouldUseWebSearch(mode: WebSearchMode, query: string): boolean {
    if (mode === 'off') {
        return false;
    }

    if (mode === 'on') {
        return Boolean(query.trim());
    }

    return shouldAutoUseWebSearch(query);
}

function truncateText(value: string, maxChars: number): string {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed.length <= maxChars) {
        return trimmed;
    }

    return `${trimmed.slice(0, maxChars - 1)}…`;
}

function normalizeSearchResult(result: AnySearchResult) {
    const title = typeof result.title === 'string' ? result.title.trim() : '';
    const url = typeof result.url === 'string' ? result.url.trim() : '';
    const description = typeof result.description === 'string' ? result.description.trim() : '';
    const content = typeof result.content === 'string' ? result.content.trim() : '';
    const summary = truncateText(content || description, MAX_RESULT_CONTENT_CHARS);

    if (!title && !url && !summary) {
        return null;
    }

    return { title, url, summary };
}

async function searchAnySearch(query: string) {
    const apiKey = readServerEnv('ANYSEARCH_API_KEY')?.trim();
    if (!apiKey) {
        throw new Error('ANYSEARCH_API_KEY is not configured.');
    }

    const apiUrl = readServerEnv('ANYSEARCH_API_URL')?.trim() || DEFAULT_ANYSEARCH_API_URL;
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query,
            max_results: DEFAULT_MAX_RESULTS,
        }),
    });

    const rawText = await response.text().catch(() => '');
    if (!response.ok) {
        throw new Error(`AnySearch request failed with status ${response.status}: ${rawText || response.statusText}`);
    }

    let payload: AnySearchPayload;
    try {
        payload = JSON.parse(rawText) as AnySearchPayload;
    } catch {
        throw new Error('AnySearch returned invalid JSON.');
    }

    if (payload.code !== 0) {
        throw new Error(`AnySearch request failed: ${String(payload.message || 'unknown error')}`);
    }

    return (payload.data?.results || [])
        .map(normalizeSearchResult)
        .filter((item): item is { title: string; url: string; summary: string } => item !== null);
}

export function buildWebSearchContextBlock(results: Array<{ title: string; url: string; summary: string }>): string {
    if (results.length === 0) {
        return '';
    }

    const lines = results.map((result, index) => [
        `${index + 1}. ${result.title || 'Untitled result'}`,
        result.url ? `URL: ${result.url}` : '',
        result.summary ? `摘要: ${result.summary}` : '',
    ].filter(Boolean).join('\n'));

    return [
        '# 联网搜索参考',
        '以下内容来自实时联网搜索。回答涉及事实、时间、价格、新闻或外部资料时，优先参考这些结果；如果结果不足以支撑结论，请明确说明不确定。',
        '',
        ...lines,
    ].join('\n\n');
}

export async function enrichSystemPromptWithWebSearch({
    systemPrompt,
    messages,
    webSearchMode = DEFAULT_WEB_SEARCH_MODE,
}: {
    systemPrompt: string;
    messages: OpenAIChatMessage[];
    webSearchMode?: WebSearchMode;
}): Promise<WebSearchEnrichmentResult> {
    const query = getLatestUserQuery(messages);
    if (!shouldUseWebSearch(webSearchMode, query)) {
        return { systemPrompt, usedWebSearch: false };
    }

    const results = await searchAnySearch(query);
    const contextBlock = buildWebSearchContextBlock(results);
    if (!contextBlock) {
        return { systemPrompt, usedWebSearch: true };
    }

    return {
        systemPrompt: `${systemPrompt.trim()}\n\n${contextBlock}`.trim(),
        usedWebSearch: true,
    };
}
