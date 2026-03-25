export const RESPONSE_MODEL_VALUES = ['gemini', 'gemini-deep-thinking', 'gpt-5.4'] as const;

export type ResponseModel = typeof RESPONSE_MODEL_VALUES[number];

export const RESPONSE_MODEL_OPTIONS = [
    { value: 'gemini', label: 'Gemini' },
    { value: 'gemini-deep-thinking', label: 'gemini深度思考' },
    { value: 'gpt-5.4', label: 'GPT-5.4' },
] as const satisfies ReadonlyArray<{ value: ResponseModel; label: string }>;

export const DEFAULT_RESPONSE_MODEL: ResponseModel = 'gemini';

export const RESPONSE_MODEL_STORAGE_PREFIX = 'chat-response-model:';

export function isResponseModel(value: unknown): value is ResponseModel {
    return typeof value === 'string' && RESPONSE_MODEL_VALUES.includes(value as ResponseModel);
}

export function getResponseModelLabel(model: ResponseModel): string {
    return RESPONSE_MODEL_OPTIONS.find((option) => option.value === model)?.label || model;
}
