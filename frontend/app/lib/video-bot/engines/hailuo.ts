import { BaseAdapter } from './base';
import type { AdapterCreateResult, AdapterQueryResult } from '../types';

function findVideoUrl(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;
    if (typeof item.download_url === 'string') return item.download_url;
    if (typeof item.video_url === 'string') return item.video_url;
    if (typeof item.file === 'object' && item.file && typeof (item.file as Record<string, unknown>).download_url === 'string') {
        return (item.file as Record<string, string>).download_url;
    }
    return findVideoUrl(item.data);
}

function findFileId(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;
    if (typeof item.file_id === 'string') return item.file_id;
    if (typeof item.file === 'object' && item.file && typeof (item.file as Record<string, unknown>).file_id === 'string') {
        return (item.file as Record<string, string>).file_id;
    }
    return findFileId(item.data);
}

export class HailuoAdapter extends BaseAdapter {
    async createTask(params: Record<string, unknown>): Promise<AdapterCreateResult> {
        const body: Record<string, unknown> = {
            model: params.model || 'MiniMax-Hailuo-2.3',
            prompt: params.prompt,
            duration: params.duration || 10,
        };

        if (params.resolution) body.resolution = params.resolution;
        if (params.enhancePrompt !== undefined) body.prompt_optimizer = params.enhancePrompt;
        if (params.firstFrameImage) body.first_frame_image = params.firstFrameImage;
        if (params.lastFrameImage) body.last_frame_image = params.lastFrameImage;

        const result = await this.httpPost<Record<string, unknown>>('/minimax/v1/video_generation', body);
        const baseResp = typeof result.base_resp === 'object' && result.base_resp ? result.base_resp as Record<string, unknown> : null;
        return {
            engineTaskId: typeof result.task_id === 'string' ? result.task_id : null,
            status: baseResp?.status_code === 0 ? 'queued' : 'failed',
        };
    }

    async queryTask(engineTaskId: string): Promise<AdapterQueryResult> {
        const result = await this.httpGet<Record<string, unknown>>(`/minimax/v1/query/video_generation?task_id=${encodeURIComponent(engineTaskId)}`);
        const data = typeof result.data === 'object' && result.data ? result.data as Record<string, unknown> : null;
        const rawStatus = String(data?.status || result.status || '').toUpperCase();

        let normalizedStatus: AdapterQueryResult['status'] = 'processing';
        if (['SUCCESS', 'COMPLETED', 'SUCCEED'].includes(rawStatus)) normalizedStatus = 'completed';
        else if (['FAILED', 'ERROR', 'FAILURE'].includes(rawStatus)) normalizedStatus = 'failed';
        else if (['QUEUEING', 'QUEUED', 'PENDING', 'SUBMITTED'].includes(rawStatus)) normalizedStatus = 'queued';

        let videoUrl = findVideoUrl(result) || findVideoUrl(data);
        const fileId = findFileId(result) || findFileId(data);
        if (!videoUrl && fileId) {
            try {
                const fileResult = await this.httpGet<Record<string, unknown>>(`/minimax/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`);
                videoUrl = findVideoUrl(fileResult);
            } catch {
                // Keep polling without failing the whole task when file lookup fails.
            }
        }

        return {
            status: normalizedStatus === 'completed' && !videoUrl ? 'processing' : normalizedStatus,
            videoUrl,
        };
    }
}
