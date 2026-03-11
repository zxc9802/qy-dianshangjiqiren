import { AppError } from './auth';
import { readServerEnv } from './server-env';

const DEFAULT_OPENAI_CHAT_URL = 'https://yunwu.ai/v1/chat/completions';
const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-5.4';

export type OpenAIContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

export type OpenAIChatMessage = {
    role: 'user' | 'assistant';
    content: string | OpenAIContentPart[];
};

type OpenAIRequestMessage = {
    role: 'system' | 'user' | 'assistant';
    content: string | OpenAIContentPart[];
};

type StreamOptions = {
    systemPrompt: string;
    messages: OpenAIChatMessage[];
    onText: (text: string) => void;
    temperature?: number;
    maxTokens?: number;
};

export function getYunwuOpenAIChatConfig(): {
    apiKey: string;
    apiUrl: string;
    model: string;
} {
    const apiKey = (
        readServerEnv('YUNWU_OPENAI_CHAT_API_KEY')
        || readServerEnv('YUNWU_OPENAI_API_KEY')
        || readServerEnv('YUNWU_CHAT_API_KEY')
        || readServerEnv('AI_API_KEY')
    );
    if (!apiKey) {
        throw new AppError('Missing chat API key configuration', 500);
    }

    const apiUrl = (
        readServerEnv('YUNWU_OPENAI_CHAT_URL')
        || readServerEnv('YUNWU_OPENAI_API_URL')
        || DEFAULT_OPENAI_CHAT_URL
    ).trim();
    const model = (
        readServerEnv('YUNWU_OPENAI_CHAT_MODEL')
        || readServerEnv('YUNWU_CHAT_MODEL')
        || readServerEnv('AI_CHAT_MODEL')
        || DEFAULT_OPENAI_CHAT_MODEL
    ).trim();

    return { apiKey, apiUrl, model };
}

function normalizeMessages(systemPrompt: string, messages: OpenAIChatMessage[]): OpenAIRequestMessage[] {
    const normalizedMessages = messages
        .filter((message) => {
            if (typeof message.content === 'string') {
                return message.content.trim().length > 0;
            }

            return Array.isArray(message.content) && message.content.length > 0;
        })
        .map((message) => ({
            role: message.role,
            content: typeof message.content === 'string' ? message.content.trim() : message.content,
        }));

    return [
        { role: 'system', content: systemPrompt.trim() },
        ...normalizedMessages,
    ];
}

function extractTextsFromContent(content: unknown): string[] {
    if (typeof content === 'string') {
        return content ? [content] : [];
    }

    if (!Array.isArray(content)) {
        return [];
    }

    const texts: string[] = [];
    for (const item of content) {
        if (typeof item === 'string') {
            if (item) texts.push(item);
            continue;
        }

        if (typeof item !== 'object' || item === null) {
            continue;
        }

        if (typeof (item as { text?: unknown }).text === 'string') {
            texts.push((item as { text: string }).text);
            continue;
        }

        if (typeof (item as { content?: unknown }).content === 'string') {
            texts.push((item as { content: string }).content);
        }
    }

    return texts;
}

export function extractOpenAIStreamTexts(payload: string): string[] {
    if (!payload || payload === '[DONE]') {
        return [];
    }

    try {
        const data = JSON.parse(payload) as {
            choices?: Array<{
                delta?: { content?: unknown };
                message?: { content?: unknown };
            }>;
        };

        const texts: string[] = [];
        for (const choice of data.choices || []) {
            texts.push(...extractTextsFromContent(choice.delta?.content));
            if (texts.length === 0) {
                texts.push(...extractTextsFromContent(choice.message?.content));
            }
        }
        return texts;
    } catch {
        return [];
    }
}

export async function streamYunwuOpenAIChat({
    systemPrompt,
    messages,
    onText,
    temperature = 0.8,
    maxTokens = 8192,
}: StreamOptions): Promise<void> {
    const { apiKey, apiUrl, model } = getYunwuOpenAIChatConfig();
    const requestMessages = normalizeMessages(systemPrompt, messages);

    const upstream = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            stream: true,
            temperature,
            max_tokens: maxTokens,
            messages: requestMessages,
        }),
    });

    if (!upstream.ok || !upstream.body) {
        const errorText = await upstream.text().catch(() => upstream.statusText);
        throw new AppError(`Upstream chat request failed: ${errorText || upstream.statusText}`, upstream.status);
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';

    while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });

        const lines = pending.split('\n');
        pending = lines.pop() || '';

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data: ')) {
                continue;
            }

            const payload = line.slice(6).trim();
            for (const text of extractOpenAIStreamTexts(payload)) {
                onText(text);
            }
        }

        if (done) {
            break;
        }
    }

    const trailing = pending.trim();
    if (trailing.startsWith('data: ')) {
        const payload = trailing.slice(6).trim();
        for (const text of extractOpenAIStreamTexts(payload)) {
            onText(text);
        }
    }
}
