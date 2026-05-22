export const RESPONSE_MODEL_VALUES = ['gemini', 'gemini-deep-thinking', 'gpt-5.4', 'claude-opus-4.6'] as const;

export type ResponseModel = typeof RESPONSE_MODEL_VALUES[number];

export const RESPONSE_MODEL_OPTIONS = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'gemini-deep-thinking', label: 'gemini深度思考' },
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
] as const satisfies ReadonlyArray<{ value: ResponseModel; label: string }>;

export const DEFAULT_RESPONSE_MODEL: ResponseModel = 'gemini';

export const RESPONSE_MODEL_STORAGE_PREFIX = 'chat-response-model:';

export const WEB_SEARCH_MODE_VALUES = ['auto', 'on', 'off'] as const;

export type WebSearchMode = typeof WEB_SEARCH_MODE_VALUES[number];

export const WEB_SEARCH_MODE_OPTIONS = [
    { value: 'auto', label: '联网自动' },
    { value: 'on', label: '联网开启' },
    { value: 'off', label: '联网关闭' },
] as const satisfies ReadonlyArray<{ value: WebSearchMode; label: string }>;

export const DEFAULT_WEB_SEARCH_MODE: WebSearchMode = 'auto';

export const WEB_SEARCH_MODE_STORAGE_PREFIX = 'chat-web-search-mode:';

export function isResponseModel(value: unknown): value is ResponseModel {
    return typeof value === 'string' && RESPONSE_MODEL_VALUES.includes(value as ResponseModel);
}

export function isWebSearchMode(value: unknown): value is WebSearchMode {
    return typeof value === 'string' && WEB_SEARCH_MODE_VALUES.includes(value as WebSearchMode);
}

export function getResponseModelLabel(model: ResponseModel): string {
    return RESPONSE_MODEL_OPTIONS.find((option) => option.value === model)?.label || model;
}

export function getWebSearchModeLabel(mode: WebSearchMode): string {
    return WEB_SEARCH_MODE_OPTIONS.find((option) => option.value === mode)?.label || mode;
}
