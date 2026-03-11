export const RESPONSE_MODEL_OPTIONS = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'gpt-5.4', label: 'GPT-5.4' },
] as const;

export type ResponseModel = typeof RESPONSE_MODEL_OPTIONS[number]['value'];

export const DEFAULT_RESPONSE_MODEL: ResponseModel = 'gemini';

export const RESPONSE_MODEL_STORAGE_PREFIX = 'chat-response-model:';
