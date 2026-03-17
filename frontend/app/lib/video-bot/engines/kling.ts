import { BaseAdapter } from './base';
import type { AdapterCreateResult, AdapterQueryResult } from '../types';

export class KlingAdapter extends BaseAdapter {
    async createTask(params: Record<string, unknown>): Promise<AdapterCreateResult> {
        const firstFrameImage = typeof params.firstFrameImage === 'string' ? params.firstFrameImage : '';
        const referenceImages = Array.isArray(params.referenceImages)
            ? params.referenceImages.filter((item): item is string => typeof item === 'string')
            : [];
        const videoUrl = typeof params.videoUrl === 'string' ? params.videoUrl : '';
        const isTextMode = !firstFrameImage && referenceImages.length === 0 && !videoUrl;
        const endpoint = isTextMode
            ? '/kling/v1/videos/text2video'
            : '/kling/v1/videos/image2video';

        const body: Record<string, unknown> = {
            model_name: params.model || 'kling-v2-master',
            prompt: params.prompt,
            mode: params.quality === 'high' ? 'pro' : 'std',
            duration: String(params.duration || 5),
            aspect_ratio: params.aspectRatio || '16:9',
        };

        if (typeof params.negativePrompt === 'string' && params.negativePrompt) {
            body.negative_prompt = params.negativePrompt;
        }
        if (typeof params.cameraMotion === 'string' && params.cameraMotion) {
            body.camera_control = { type: params.cameraMotion };
        }
        if (firstFrameImage) {
            body.image = firstFrameImage;
        }
        if (typeof params.lastFrameImage === 'string' && params.lastFrameImage) {
            body.image_tail = params.lastFrameImage;
        }
        if (videoUrl) {
            body.video_url = videoUrl;
        }

        const result = await this.httpPost<Record<string, unknown>>(endpoint, body);
        const data = typeof result.data === 'object' && result.data ? result.data as Record<string, unknown> : null;
        const taskId = typeof data?.task_id === 'string'
            ? data.task_id
            : typeof result.task_id === 'string'
                ? result.task_id
                : typeof result.id === 'string'
                    ? result.id
                    : null;

        return {
            engineTaskId: taskId,
            status: this.normalizeStatus(typeof data?.task_status === 'string' ? data.task_status : typeof result.status === 'string' ? result.status : 'queued'),
        };
    }

    async queryTask(engineTaskId: string): Promise<AdapterQueryResult> {
        let result: Record<string, unknown>;
        try {
            result = await this.httpGet<Record<string, unknown>>(`/kling/v1/videos/text2video/${encodeURIComponent(engineTaskId)}`);
        } catch {
            result = await this.httpGet<Record<string, unknown>>(`/kling/v1/videos/image2video/${encodeURIComponent(engineTaskId)}`);
        }

        const taskData = typeof result.data === 'object' && result.data ? result.data as Record<string, unknown> : result;
        const taskResult = typeof taskData.task_result === 'object' && taskData.task_result ? taskData.task_result as Record<string, unknown> : null;
        const videos = Array.isArray(taskResult?.videos) ? taskResult.videos : [];
        const firstVideo = typeof videos[0] === 'object' && videos[0] ? videos[0] as Record<string, unknown> : null;

        return {
            status: this.normalizeStatus(typeof taskData.task_status === 'string' ? taskData.task_status : typeof taskData.status === 'string' ? taskData.status : ''),
            videoUrl: typeof firstVideo?.url === 'string' ? firstVideo.url : null,
        };
    }
}
