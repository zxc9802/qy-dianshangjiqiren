import { Prisma, type VideoGeneration } from '@prisma/client';
import { AppError } from './auth';

const VIDEO_GENERATION_MODES = ['text2video', 'image2video', 'keyframe', 'video2video'] as const;
const VIDEO_GENERATION_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const;

export type VideoGenerationMode = typeof VIDEO_GENERATION_MODES[number];
export type VideoGenerationStatus = typeof VIDEO_GENERATION_STATUSES[number];

interface VideoGenerationPayload {
    engine?: unknown;
    mode?: unknown;
    model?: unknown;
    prompt?: unknown;
    negativePrompt?: unknown;
    params?: unknown;
    inputs?: unknown;
    engineTaskId?: unknown;
    videoUrl?: unknown;
    status?: unknown;
    errorMessage?: unknown;
    completedAt?: unknown;
}

export interface NormalizedVideoGenerationPayload {
    engine?: string;
    mode?: VideoGenerationMode;
    model?: string | null;
    prompt?: string | null;
    negativePrompt?: string | null;
    params?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
    inputs?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
    engineTaskId?: string | null;
    videoUrl?: string | null;
    status?: VideoGenerationStatus;
    errorMessage?: string | null;
    completedAt?: Date | null;
}

export function normalizeVideoGeneration(record: VideoGeneration) {
    return {
        id: record.id,
        engine: record.engine,
        mode: record.mode,
        model: record.model,
        prompt: record.prompt,
        negativePrompt: record.negativePrompt,
        params: record.params ?? {},
        inputs: record.inputs ?? {},
        engineTaskId: record.engineTaskId,
        videoUrl: record.videoUrl,
        status: record.status,
        error: record.errorMessage,
        errorMessage: record.errorMessage,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    };
}

export function normalizeCreateVideoGenerationPayload(payload: unknown): NormalizedVideoGenerationPayload {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new AppError('Request body is required.');
    }

    const input = payload as VideoGenerationPayload;

    return {
        engine: normalizeRequiredString(input.engine, 'engine'),
        mode: normalizeMode(input.mode, 'mode'),
        model: normalizeOptionalString(input.model),
        prompt: normalizeOptionalString(input.prompt),
        negativePrompt: normalizeOptionalString(input.negativePrompt),
        params: normalizeJsonValue(input.params),
        inputs: normalizeJsonValue(input.inputs),
        engineTaskId: normalizeOptionalString(input.engineTaskId),
        videoUrl: normalizeOptionalString(input.videoUrl),
        status: normalizeStatus(input.status, 'status') ?? 'queued',
        errorMessage: normalizeOptionalString(input.errorMessage),
        completedAt: normalizeOptionalDate(input.completedAt, 'completedAt'),
    };
}

export function normalizeUpdateVideoGenerationPayload(payload: unknown): NormalizedVideoGenerationPayload {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new AppError('Request body is required.');
    }

    const input = payload as VideoGenerationPayload;
    const updates: NormalizedVideoGenerationPayload = {};

    if ('engine' in input) updates.engine = normalizeRequiredString(input.engine, 'engine');
    if ('mode' in input) updates.mode = normalizeMode(input.mode, 'mode');
    if ('model' in input) updates.model = normalizeOptionalString(input.model);
    if ('prompt' in input) updates.prompt = normalizeOptionalString(input.prompt);
    if ('negativePrompt' in input) updates.negativePrompt = normalizeOptionalString(input.negativePrompt);
    if ('params' in input) updates.params = normalizeJsonValue(input.params);
    if ('inputs' in input) updates.inputs = normalizeJsonValue(input.inputs);
    if ('engineTaskId' in input) updates.engineTaskId = normalizeOptionalString(input.engineTaskId);
    if ('videoUrl' in input) updates.videoUrl = normalizeOptionalString(input.videoUrl);
    if ('status' in input) updates.status = normalizeStatus(input.status, 'status');
    if ('errorMessage' in input) updates.errorMessage = normalizeOptionalString(input.errorMessage);
    if ('completedAt' in input) updates.completedAt = normalizeOptionalDate(input.completedAt, 'completedAt');

    if (Object.keys(updates).length === 0) {
        throw new AppError('At least one updatable field is required.');
    }

    return updates;
}

function normalizeRequiredString(value: unknown, field: string): string {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        throw new AppError(`${field} is required.`);
    }
    return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value !== 'string') {
        throw new AppError('Expected a string field.');
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeMode(value: unknown, field: string): VideoGenerationMode {
    if (typeof value !== 'string') {
        throw new AppError(`${field} must be a string.`);
    }

    const normalized = value.trim().toLowerCase();
    if ((VIDEO_GENERATION_MODES as readonly string[]).includes(normalized)) {
        return normalized as VideoGenerationMode;
    }

    throw new AppError(`${field} is not supported.`);
}

function normalizeStatus(value: unknown, field: string): VideoGenerationStatus | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new AppError(`${field} must be a string.`);
    }

    const normalized = value.trim().toLowerCase();
    if ((VIDEO_GENERATION_STATUSES as readonly string[]).includes(normalized)) {
        return normalized as VideoGenerationStatus;
    }

    throw new AppError(`${field} is not supported.`);
}

function normalizeOptionalDate(value: unknown, field: string): Date | null | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (value === null || value === '') {
        return null;
    }

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new AppError(`${field} is not a valid date.`);
        }
        return value;
    }

    if (typeof value === 'string') {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            throw new AppError(`${field} is not a valid date.`);
        }
        return parsed;
    }

    throw new AppError(`${field} is not a valid date.`);
}

function normalizeJsonValue(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return Prisma.JsonNull;
    }

    try {
        return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    } catch {
        throw new AppError('JSON field is not serializable.');
    }
}
