import { AppError } from './auth';
import { readServerEnv } from './server-env';

const DEFAULT_GEMINI_MEDIA_URL = 'https://yunwu.ai/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse';

export function normalizeGeminiMediaUrl(rawUrl?: string): string {
    let url = (rawUrl || DEFAULT_GEMINI_MEDIA_URL).trim();
    url = url.replace(':generateContent', ':streamGenerateContent');

    if (!/[?&]alt=sse(?:&|$)/.test(url)) {
        url += url.includes('?') ? '&alt=sse' : '?alt=sse';
    }

    return url;
}

export function parseGeminiSseText(sseBody: string): string {
    let result = '';

    for (const line of sseBody.split('\n')) {
        if (!line.startsWith('data: ')) {
            continue;
        }

        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') {
            continue;
        }

        try {
            const data = JSON.parse(jsonStr) as {
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
                    result += part.text;
                }
            }
        } catch {
            continue;
        }
    }

    return result;
}

export async function describeImageWithGemini(
    base64Data: string,
    mimeType: string,
    prompt = '请详细描述这张图片的内容，包括文字、主体、场景、布局、颜色和任何可见信息。',
): Promise<string> {
    const apiKey = readServerEnv('YUNWU_UPLOAD_API_KEY') || readServerEnv('AI_API_KEY') || readServerEnv('YUNWU_CHAT_API_KEY');
    if (!apiKey) {
        throw new AppError('Missing Gemini media API key configuration', 500);
    }

    const apiUrl = normalizeGeminiMediaUrl(readServerEnv('YUNWU_UPLOAD_API_URL') || readServerEnv('AI_API_URL'));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
        const upstream = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [
                        {
                            inlineData: { mimeType, data: base64Data },
                        },
                        { text: prompt },
                    ],
                }],
                generationConfig: {
                    temperature: 0.1,
                    topP: 1,
                },
            }),
        });

        if (!upstream.ok) {
            const errorText = await upstream.text().catch(() => upstream.statusText);
            throw new AppError(`Gemini media request failed: ${errorText || upstream.statusText}`, upstream.status);
        }

        const sseBody = await upstream.text();
        const extractedText = parseGeminiSseText(sseBody).trim();
        if (!extractedText) {
            throw new AppError('Gemini media response was empty.', 502);
        }

        return extractedText;
    } finally {
        clearTimeout(timeout);
    }
}
