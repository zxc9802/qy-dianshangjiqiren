export type VideoBotEngineId = 'veo' | 'runway' | 'wan' | 'kling' | 'hailuo';

export type VideoBotMode = 'text2video' | 'image2video' | 'keyframe' | 'video2video';

export type VideoBotStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface VideoBotOption {
    value: string;
    label: string;
}

export interface VideoBotParamsConfig {
    aspectRatio?: string[] | false;
    duration?: number[] | false;
    resolution?: string[] | false;
    enhancePrompt?: boolean;
    enableUpsample?: boolean;
    cameraMotion?: string[] | false;
    negativePrompt?: boolean;
    watermark?: boolean;
    audio?: boolean;
}

export interface VideoBotEngineConfig {
    name: string;
    label: string;
    color: string;
    models: VideoBotOption[];
    modes: VideoBotMode[];
    params: VideoBotParamsConfig;
    modeModels?: Partial<Record<VideoBotMode, VideoBotOption[]>>;
    modeParams?: Partial<Record<VideoBotMode, VideoBotParamsConfig>>;
}

export type VideoBotConfigMap = Record<string, VideoBotEngineConfig>;

export interface VideoBotTaskInputs extends Record<string, unknown> {
    firstFrameImage?: string | null;
    lastFrameImage?: string | null;
    referenceImages?: string[];
    videoUrl?: string | null;
}

export interface VideoBotTaskRecord {
    id: string;
    userId: string;
    engine: VideoBotEngineId;
    mode: VideoBotMode;
    status: VideoBotStatus;
    model?: string | null;
    prompt?: string | null;
    params: Record<string, unknown>;
    inputs: VideoBotTaskInputs;
    engineTaskId?: string | null;
    videoUrl?: string | null;
    error?: string | null;
    pollError?: string | null;
    createdAt: string;
    completedAt?: string | null;
}

export interface CreateVideoBotTaskPayload {
    engine: VideoBotEngineId;
    mode: VideoBotMode;
    apiKey: string;
    params: Record<string, unknown>;
}

export interface VideoBotTaskUpdate {
    status?: VideoBotStatus;
    model?: string | null;
    engineTaskId?: string | null;
    videoUrl?: string | null;
    error?: string | null;
    completedAt?: string | null;
    inputs?: VideoBotTaskInputs;
    pollError?: string | null;
}

export interface AdapterCreateResult {
    engineTaskId: string | null;
    status: VideoBotStatus;
    model?: string | null;
}

export interface AdapterQueryResult {
    status: VideoBotStatus;
    videoUrl?: string | null;
    error?: string | null;
    engineTaskId?: string | null;
    model?: string | null;
    inputs?: VideoBotTaskInputs;
}
