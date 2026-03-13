const HTML_START_PATTERN = /^\s*(?:<!doctype html|<html\b|<head\b|<body\b)/i;
const HTML_TAG_PATTERN = /<html\b|<head\b|<body\b|<\/html>/i;
const CLOUDFLARE_TIMEOUT_PATTERN = /\b(?:cloudflare|error code\s*524|a timeout occurred)\b/i;
const HTTP_TIMEOUT_PATTERN = /\b(?:504|524|timeout)\b/i;

type NormalizeOptions = {
    timeoutMessage?: string;
    genericMessage?: string;
};

const DEFAULT_TIMEOUT_MESSAGE = '服务超时，请稍后重试或切换 Gemini。';
const DEFAULT_GENERIC_MESSAGE = '服务暂时不可用，请稍后重试。';

function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

export function truncateForLog(text: string, max = 240): string {
    const normalized = collapseWhitespace(text);
    if (normalized.length <= max) {
        return normalized;
    }

    return `${normalized.slice(0, max)}...`;
}

export function looksLikeHtmlPayload(text: string): boolean {
    const normalized = text.trim();
    if (!normalized) {
        return false;
    }

    return HTML_START_PATTERN.test(normalized) || (normalized.includes('<') && HTML_TAG_PATTERN.test(normalized));
}

export function looksLikeTimeoutPayload(text: string): boolean {
    const normalized = text.trim();
    if (!normalized) {
        return false;
    }

    return CLOUDFLARE_TIMEOUT_PATTERN.test(normalized) || (looksLikeHtmlPayload(normalized) && HTTP_TIMEOUT_PATTERN.test(normalized));
}

export function normalizeUpstreamErrorMessage(input: unknown, options: NormalizeOptions = {}): string {
    const timeoutMessage = options.timeoutMessage || DEFAULT_TIMEOUT_MESSAGE;
    const genericMessage = options.genericMessage || DEFAULT_GENERIC_MESSAGE;

    if (typeof input !== 'string') {
        return genericMessage;
    }

    const normalized = collapseWhitespace(input);
    if (!normalized) {
        return genericMessage;
    }

    if (looksLikeTimeoutPayload(normalized)) {
        return timeoutMessage;
    }

    if (looksLikeHtmlPayload(normalized)) {
        return genericMessage;
    }

    return normalized.length > 300 ? `${normalized.slice(0, 300)}...` : normalized;
}
