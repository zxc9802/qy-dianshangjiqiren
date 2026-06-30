const DEFAULT_GEMINI_IMAGE_API_URL = 'https://yunwu.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent';
const DEFAULT_OPENAI_IMAGE_BASE_URL = 'https://yunwu.ai/v1';
const DEFAULT_OPENAI_IMAGE_ENDPOINT_PATH = '/images/generations';
const DEFAULT_OPENAI_IMAGE_SIZE = '1024x1024';
const OPENAI_IMAGE_BASE_SIZE = 1024;

type EnvSource = Record<string, string | undefined>;

export type ImageProviderConfig =
    | {
        kind: 'gemini';
        apiUrl: string;
    }
    | {
        kind: 'openai';
        apiKey: string;
        endpointUrl: string;
        model: string;
        size: string;
        responseFormat?: string;
    };

export type ImageProviderRequest = {
    url: string;
    headers: Record<string, string>;
    body: string;
};

export type GeneratedImageResult =
    | {
        kind: 'base64';
        mimeType: string;
        data: string;
    }
    | {
        kind: 'url';
        url: string;
    };

function readEnv(env: EnvSource, key: string): string {
    return env[key]?.trim() || '';
}

function joinUrl(baseUrl: string, endpointPath: string): string {
    const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    return `${baseUrl.replace(/\/+$/, '')}${normalizedPath}`;
}

function addGeminiApiKey(apiUrl: string, apiKey: string): string {
    const url = new URL(apiUrl);
    if (!url.searchParams.has('key')) {
        url.searchParams.set('key', apiKey);
    }
    return url.toString();
}

function parseAspectRatio(value: string): { width: number; height: number; label: string } | null {
    const match = value.match(/(?:比例|画幅|尺寸|ratio|aspect)?\s*(\d{1,2})\s*(?::|：|比|\/)\s*(\d{1,2})/i);
    if (!match) return null;

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }

    return { width, height, label: `${width}:${height}` };
}

function roundToImageStep(value: number): number {
    return Math.max(64, Math.round(value / 8) * 8);
}

function sizeFromAspectRatio(ratio: { width: number; height: number }): string {
    if (ratio.width >= ratio.height) {
        return `${OPENAI_IMAGE_BASE_SIZE}x${roundToImageStep((OPENAI_IMAGE_BASE_SIZE * ratio.height) / ratio.width)}`;
    }

    return `${roundToImageStep((OPENAI_IMAGE_BASE_SIZE * ratio.width) / ratio.height)}x${OPENAI_IMAGE_BASE_SIZE}`;
}

function resolveAspectRatio(prompt: string, aspectRatio: string): { width: number; height: number; label: string } | null {
    return parseAspectRatio(prompt) || parseAspectRatio(aspectRatio);
}

function resolveOpenAIImageSize(prompt: string, aspectRatio: string, fallbackSize: string): string {
    const ratio = resolveAspectRatio(prompt, aspectRatio);
    return ratio ? sizeFromAspectRatio(ratio) : fallbackSize;
}

export function buildImageProviderConfig(env: EnvSource = process.env): ImageProviderConfig {
    const apiKey = readEnv(env, 'YUNWU_IMAGE_API_KEY') || readEnv(env, 'AI_API_KEY');
    if (!apiKey) {
        throw new Error('YUNWU_IMAGE_API_KEY or AI_API_KEY is not configured');
    }

    const openAIModel = readEnv(env, 'YUNWU_IMAGE_MODEL');
    const openAIBaseUrl = readEnv(env, 'YUNWU_IMAGE_BASE_URL');

    if (openAIModel || openAIBaseUrl) {
        if (!openAIModel) {
            throw new Error('YUNWU_IMAGE_MODEL is not configured');
        }

        const endpointPath = readEnv(env, 'YUNWU_IMAGE_ENDPOINT_PATH') || DEFAULT_OPENAI_IMAGE_ENDPOINT_PATH;
        return {
            kind: 'openai',
            apiKey,
            endpointUrl: joinUrl(openAIBaseUrl || DEFAULT_OPENAI_IMAGE_BASE_URL, endpointPath),
            model: openAIModel,
            size: readEnv(env, 'YUNWU_IMAGE_SIZE') || DEFAULT_OPENAI_IMAGE_SIZE,
            responseFormat: readEnv(env, 'YUNWU_IMAGE_RESPONSE_FORMAT') || undefined,
        };
    }

    const geminiApiUrl = readEnv(env, 'YUNWU_IMAGE_API_URL') || DEFAULT_GEMINI_IMAGE_API_URL;
    return {
        kind: 'gemini',
        apiUrl: addGeminiApiKey(geminiApiUrl, apiKey),
    };
}

export function buildImageProviderRequest(
    config: ImageProviderConfig,
    input: {
        prompt: string;
        aspectRatio: string;
        referenceImage?: { mimeType: string; base64: string };
    },
): ImageProviderRequest {
    if (config.kind === 'openai') {
        const size = resolveOpenAIImageSize(input.prompt, input.aspectRatio, config.size);
        const body: Record<string, unknown> = {
            model: config.model,
            prompt: input.prompt,
            size,
            n: 1,
        };
        if (config.responseFormat) {
            body.response_format = config.responseFormat;
        }

        return {
            url: config.endpointUrl,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        };
    }

    const parts: Array<Record<string, unknown>> = [];
    if (input.referenceImage) {
        parts.push({
            inlineData: {
                mimeType: input.referenceImage.mimeType,
                data: input.referenceImage.base64,
            },
        });
    }
    parts.push({ text: input.prompt });

    return {
        url: config.apiUrl,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: {
                    imageSize: '2K',
                    aspectRatio: resolveAspectRatio(input.prompt, input.aspectRatio)?.label || input.aspectRatio,
                },
            },
        }),
    };
}

export function extractGeneratedImageResult(responseData: unknown): GeneratedImageResult | null {
    if (!responseData || typeof responseData !== 'object') return null;
    const record = responseData as Record<string, unknown>;

    const openAIItems = record.data;
    if (Array.isArray(openAIItems)) {
        for (const item of openAIItems) {
            if (!item || typeof item !== 'object') continue;
            const candidate = item as Record<string, unknown>;
            if (typeof candidate.url === 'string' && candidate.url) {
                return { kind: 'url', url: candidate.url };
            }
            if (typeof candidate.b64_json === 'string' && candidate.b64_json) {
                return { kind: 'base64', mimeType: 'image/png', data: candidate.b64_json };
            }
        }
    }

    const candidates = record.candidates as Array<Record<string, unknown>> | undefined;
    const first = candidates?.[0];
    const content = first?.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, unknown>> | undefined;
    if (!parts) return null;

    for (const part of parts) {
        const inlineData = part.inlineData as Record<string, unknown> | undefined;
        const mimeType = inlineData?.mimeType;
        const data = inlineData?.data;
        if (typeof mimeType === 'string' && typeof data === 'string' && data.length > 0) {
            return { kind: 'base64', mimeType, data };
        }
    }

    return null;
}
