import { AppError, errorResponse, getAuthUser } from '@/app/lib/auth';
import { createTask, getAllTasks } from '@/app/lib/video-bot/db';
import { getAdapter } from '@/app/lib/video-bot/engines';
import type { CreateVideoBotTaskPayload, VideoBotEngineId, VideoBotMode, VideoBotTaskInputs, VideoBotTaskRecord } from '@/app/lib/video-bot/types';
import { NextRequest } from 'next/server';

const ENGINE_IDS = new Set<VideoBotEngineId>(['veo', 'runway', 'wan', 'kling', 'hailuo']);
const MODES = new Set<VideoBotMode>(['text2video', 'image2video', 'keyframe', 'video2video']);

function readInputs(params: Record<string, unknown>): VideoBotTaskInputs {
    const referenceImages = Array.isArray(params.referenceImages)
        ? params.referenceImages.filter((item): item is string => typeof item === 'string')
        : [];

    return {
        firstFrameImage: typeof params.firstFrameImage === 'string' ? params.firstFrameImage : null,
        lastFrameImage: typeof params.lastFrameImage === 'string' ? params.lastFrameImage : null,
        referenceImages,
        videoUrl: typeof params.videoUrl === 'string' ? params.videoUrl : null,
    };
}

function assertPayload(value: unknown): CreateVideoBotTaskPayload {
    if (!value || typeof value !== 'object') {
        throw new AppError('请求体不能为空。');
    }

    const payload = value as Partial<CreateVideoBotTaskPayload>;
    if (!payload.apiKey || typeof payload.apiKey !== 'string' || !payload.apiKey.trim()) {
        throw new AppError('请先输入 API Key。');
    }
    if (!payload.engine || typeof payload.engine !== 'string' || !ENGINE_IDS.has(payload.engine as VideoBotEngineId)) {
        throw new AppError('请选择有效的视频引擎。');
    }
    if (!payload.mode || typeof payload.mode !== 'string' || !MODES.has(payload.mode as VideoBotMode)) {
        throw new AppError('请选择有效的生成模式。');
    }
    if (!payload.params || typeof payload.params !== 'object' || Array.isArray(payload.params)) {
        throw new AppError('参数格式无效。');
    }

    return {
        apiKey: payload.apiKey.trim(),
        engine: payload.engine as VideoBotEngineId,
        mode: payload.mode as VideoBotMode,
        params: payload.params as Record<string, unknown>,
    };
}

export async function GET(req: NextRequest) {
    try {
        const user = await getAuthUser(req);
        return Response.json(getAllTasks(user.id));
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const user = await getAuthUser(req);
        const payload = assertPayload(await req.json());
        const adapter = getAdapter(payload.engine, payload.apiKey);
        const result = await adapter.createTask({
            ...payload.params,
            mode: payload.mode,
        });

        const task: VideoBotTaskRecord = {
            id: crypto.randomUUID(),
            userId: user.id,
            engine: payload.engine,
            mode: payload.mode,
            status: result.status,
            model: result.model ?? (typeof payload.params.model === 'string' ? payload.params.model : null),
            prompt: typeof payload.params.prompt === 'string' ? payload.params.prompt : null,
            params: payload.params,
            inputs: readInputs(payload.params),
            engineTaskId: result.engineTaskId,
            videoUrl: null,
            error: null,
            pollError: null,
            createdAt: new Date().toISOString(),
            completedAt: null,
        };

        createTask(task);
        return Response.json(task, { status: 201 });
    } catch (error) {
        return errorResponse(error);
    }
}
