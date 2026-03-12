import { AppError } from './auth';
import { readServerEnv } from './server-env';

const DEFAULT_GEMINI_CHAT_URL = 'https://yunwu.ai/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse';

export type GeminiChatMessage = {
    role: 'user' | 'assistant';
    content: string | GeminiChatPart[];
};

export type GeminiChatPart =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } };

type StreamOptions = {
    systemPrompt: string;
    messages: GeminiChatMessage[];
    onText: (text: string) => void;
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
};

function normalizeStreamUrl(rawUrl?: string): string {
    let url = (rawUrl || DEFAULT_GEMINI_CHAT_URL).trim();
    url = url.replace(':generateContent', ':streamGenerateContent');
    if (!/[?&]alt=sse(?:&|$)/.test(url)) {
        url += url.includes('?') ? '&alt=sse' : '?alt=sse';
    }
    return url;
}

export async function streamYunwuGeminiChat({
    systemPrompt,
    messages,
    onText,
    temperature = 0.8,
    topP = 0.95,
    maxOutputTokens = 8192,
}: StreamOptions): Promise<void> {
    const apiKey = readServerEnv('YUNWU_CHAT_API_KEY') || readServerEnv('AI_API_KEY');
    if (!apiKey) {
        throw new AppError('Missing chat API key configuration', 500);
    }

    const apiUrl = normalizeStreamUrl(readServerEnv('YUNWU_CHAT_API_URL') || readServerEnv('AI_API_URL'));
    const contents = messages
        .map((message) => {
            const parts = typeof message.content === 'string'
                ? (message.content.trim() ? [{ text: message.content.trim() }] : [])
                : message.content.filter((part) => ('text' in part ? part.text.trim().length > 0 : Boolean(part.inlineData?.data)));

            return {
                role: message.role === 'assistant' ? 'model' : 'user',
                parts,
            };
        })
        .filter((message) => message.parts.length > 0);

    const upstream = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                temperature,
                topP,
                maxOutputTokens,
            },
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
            if (!line.startsWith('data:')) {
                continue;
            }

            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') {
                continue;
            }

            try {
                const data = JSON.parse(payload) as {
                    candidates?: Array<{
                        content?: {
                            parts?: Array<{ text?: string; thought?: boolean }>;
                        };
                    }>;
                };

                const parts = data?.candidates?.[0]?.content?.parts;
                if (!Array.isArray(parts)) {
                    continue;
                }

                for (const part of parts) {
                    if (part?.text && !part?.thought) {
                        onText(part.text);
                    }
                }
            } catch {
                continue;
            }
        }

        if (done) {
            break;
        }
    }

    const trailing = pending.trim();
    if (trailing.startsWith('data:')) {
        const payload = trailing.slice(5).trim();
        try {
            const data = JSON.parse(payload) as {
                candidates?: Array<{
                    content?: {
                        parts?: Array<{ text?: string; thought?: boolean }>;
                    };
                }>;
            };
            const parts = data?.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
                for (const part of parts) {
                    if (part?.text && !part?.thought) {
                        onText(part.text);
                    }
                }
            }
        } catch {
            // Ignore trailing partial chunk.
        }
    }
}
