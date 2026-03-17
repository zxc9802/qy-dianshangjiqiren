import { BaseAdapter } from './base';
import type { AdapterCreateResult, AdapterQueryResult } from '../types';

const WAN_IMAGE_MODEL = 'wan2.5-i2v-preview';
const WAN_KEYFRAME_MODEL = 'wan2.2-kf2v-flash';
const WAN_TEXT_IMAGE_MODEL = 'wanx-v1';

const WAN_MODELS: Record<string, string[]> = {
    text2video: [WAN_IMAGE_MODEL],
    image2video: [WAN_IMAGE_MODEL, 'wan2.6-i2v'],
    keyframe: [WAN_KEYFRAME_MODEL],
};

const WAN_DEFAULT_MODEL: Record<string, string> = {
    text2video: WAN_IMAGE_MODEL,
    image2video: WAN_IMAGE_MODEL,
    keyframe: WAN_KEYFRAME_MODEL,
};

const WAN_TEXT_IMAGE_SIZE_MAP: Record<string, string> = {
    '16:9': '1280*720',
    '9:16': '720*1280',
    '1:1': '1024*1024',
};

function resolveWanModel(requestedModel: string | undefined, mode: string): string {
    const allowedModels = WAN_MODELS[mode] || WAN_MODELS.image2video;
    if (requestedModel && allowedModels.includes(requestedModel)) {
        return requestedModel === 'wan2.6-i2v' ? WAN_IMAGE_MODEL : requestedModel;
    }
    return WAN_DEFAULT_MODEL[mode] || WAN_DEFAULT_MODEL.image2video;
}

function encodeWanState(state: Record<string, unknown>): string {
    return `wan:${Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')}`;
}

function decodeWanState(raw: string): Record<string, string> {
    if (!raw.startsWith('wan:')) {
        return { stage: 'i2v', taskId: raw };
    }

    try {
        return JSON.parse(Buffer.from(raw.slice(4), 'base64url').toString('utf8')) as Record<string, string>;
    } catch {
        return { stage: 'i2v', taskId: raw };
    }
}

function readStatus(payload: Record<string, unknown>): string {
    const output = typeof payload.output === 'object' && payload.output ? payload.output as Record<string, unknown> : null;
    if (typeof output?.task_status === 'string') return output.task_status;
    return typeof payload.status === 'string' ? payload.status : '';
}

function readTaskId(payload: Record<string, unknown>): string | null {
    const output = typeof payload.output === 'object' && payload.output ? payload.output as Record<string, unknown> : null;
    if (typeof output?.task_id === 'string') return output.task_id;
    return typeof payload.task_id === 'string' ? payload.task_id : null;
}

function readResultUrl(payload: Record<string, unknown>): string | null {
    const output = typeof payload.output === 'object' && payload.output ? payload.output as Record<string, unknown> : null;
    const outputResults = Array.isArray(output?.results) ? output.results : [];
    const rootResults = Array.isArray(payload.results) ? payload.results : [];
    if (typeof output?.video_url === 'string') return output.video_url;
    if (typeof output?.image_url === 'string') return output.image_url;
    if (typeof output?.result_url === 'string') return output.result_url;
    if (typeof outputResults[0] === 'object' && outputResults[0] && typeof (outputResults[0] as Record<string, unknown>).url === 'string') {
        return (outputResults[0] as Record<string, string>).url;
    }
    if (typeof rootResults[0] === 'object' && rootResults[0] && typeof (rootResults[0] as Record<string, unknown>).url === 'string') {
        return (rootResults[0] as Record<string, string>).url;
    }
    return null;
}

export class WanAdapter extends BaseAdapter {
    private async createTextImageTask(params: Record<string, unknown>): Promise<string | null> {
        const result = await this.httpPost<Record<string, unknown>>(
            '/alibailian/api/v1/services/aigc/text2image/image-synthesis',
            {
                model: WAN_TEXT_IMAGE_MODEL,
                input: {
                    prompt: params.prompt,
                },
                parameters: {
                    size: WAN_TEXT_IMAGE_SIZE_MAP[String(params.aspectRatio ?? '16:9')] || WAN_TEXT_IMAGE_SIZE_MAP['16:9'],
                    n: 1,
                    prompt_extend: params.enhancePrompt !== false,
                },
            },
            {
                headers: {
                    'X-DashScope-Async': 'enable',
                },
                timeoutMs: 20_000,
            },
        );

        return readTaskId(result);
    }

    private async createImageVideoTask(
        params: Record<string, unknown>,
        imageUrl: string,
        model = WAN_IMAGE_MODEL,
    ): Promise<{ taskId: string | null; status: AdapterCreateResult['status'] }> {
        const result = await this.httpPost<Record<string, unknown>>(
            '/alibailian/api/v1/services/aigc/video-generation/video-synthesis',
            {
                model,
                input: {
                    prompt: params.prompt,
                    img_url: imageUrl,
                },
                parameters: {
                    resolution: params.resolution || '720P',
                    duration: params.duration || 5,
                    prompt_extend: params.enhancePrompt !== false,
                },
            },
            {
                headers: {
                    'X-DashScope-Async': 'enable',
                },
                timeoutMs: 20_000,
            },
        );

        return {
            taskId: readTaskId(result),
            status: this.normalizeStatus(readStatus(result)),
        };
    }

    async createTask(params: Record<string, unknown>): Promise<AdapterCreateResult> {
        const mode = String(params.mode ?? 'image2video');
        const requestedModel = typeof params.model === 'string' ? params.model : undefined;
        const model = resolveWanModel(requestedModel, mode);

        if (mode === 'text2video') {
            const textImageTaskId = await this.createTextImageTask(params);
            return {
                engineTaskId: encodeWanState({
                    stage: 't2i',
                    taskId: textImageTaskId,
                    videoModel: WAN_IMAGE_MODEL,
                    imageModel: WAN_TEXT_IMAGE_MODEL,
                }),
                model: WAN_IMAGE_MODEL,
                status: 'queued',
            };
        }

        if (mode === 'keyframe') {
            if (!params.firstFrameImage || !params.lastFrameImage) {
                throw new Error('Keyframe mode requires both first frame and last frame images');
            }

            const result = await this.httpPost<Record<string, unknown>>(
                '/alibailian/api/v1/services/aigc/image2video/video-synthesis',
                {
                    model,
                    input: {
                        first_frame_url: params.firstFrameImage,
                        last_frame_url: params.lastFrameImage,
                        prompt: params.prompt,
                    },
                    parameters: {
                        resolution: params.resolution || '720P',
                        duration: params.duration || 5,
                        prompt_extend: params.enhancePrompt !== false,
                    },
                },
                {
                    headers: {
                        'X-DashScope-Async': 'enable',
                    },
                    timeoutMs: 20_000,
                },
            );

            return {
                engineTaskId: readTaskId(result),
                model,
                status: this.normalizeStatus(readStatus(result)),
            };
        }

        if (!params.firstFrameImage) {
            throw new Error('Image-to-video mode requires a first frame image');
        }

        const imageVideoTask = await this.createImageVideoTask(params, String(params.firstFrameImage), model);
        return {
            engineTaskId: imageVideoTask.taskId,
            model,
            status: imageVideoTask.status,
        };
    }

    async queryTask(engineTaskId: string, task?: { params?: Record<string, unknown>; inputs?: Record<string, unknown> }): Promise<AdapterQueryResult> {
        const state = decodeWanState(engineTaskId);

        if (state.stage === 't2i' && state.taskId) {
            const imageResult = await this.httpGet<Record<string, unknown>>(`/alibailian/api/v1/tasks/${encodeURIComponent(state.taskId)}`);
            const normalizedStatus = this.normalizeStatus(readStatus(imageResult));
            const imageUrl = readResultUrl(imageResult);

            if (normalizedStatus === 'failed') {
                const errorInfo = typeof imageResult.error === 'object' && imageResult.error
                    ? imageResult.error as Record<string, unknown>
                    : null;
                return {
                    status: 'failed',
                    error: typeof errorInfo?.message === 'string'
                        ? errorInfo.message
                        : typeof imageResult.message === 'string'
                            ? imageResult.message
                            : 'Wan first-frame generation failed',
                };
            }

            if (!imageUrl) {
                return {
                    status: normalizedStatus === 'completed' ? 'processing' : normalizedStatus,
                };
            }

            const imageVideoTask = await this.createImageVideoTask(task?.params ?? {}, imageUrl, state.videoModel || WAN_IMAGE_MODEL);
            return {
                status: imageVideoTask.status,
                engineTaskId: encodeWanState({
                    stage: 'i2v',
                    taskId: imageVideoTask.taskId,
                }),
                inputs: {
                    ...(task?.inputs ?? {}),
                    firstFrameImage: imageUrl,
                },
                model: state.videoModel || WAN_IMAGE_MODEL,
            };
        }

        const videoTaskId = state.taskId || engineTaskId;
        const result = await this.httpGet<Record<string, unknown>>(`/alibailian/api/v1/tasks/${encodeURIComponent(videoTaskId)}`);
        const status = this.normalizeStatus(readStatus(result));
        return {
            status,
            videoUrl: readResultUrl(result),
            ...(status === 'failed'
                ? {
                    error: (() => {
                        const output = typeof result.output === 'object' && result.output ? result.output as Record<string, unknown> : null;
                        if (typeof output?.message === 'string') return output.message;
                        if (typeof output?.code === 'string') return output.code;
                        return typeof result.message === 'string' ? result.message : 'Wan generation failed';
                    })(),
                }
                : {}),
        };
    }
}
