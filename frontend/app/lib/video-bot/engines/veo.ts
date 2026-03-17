import { BaseAdapter } from './base';
import type { AdapterCreateResult, AdapterQueryResult } from '../types';

export class VeoAdapter extends BaseAdapter {
    async createTask(params: Record<string, unknown>): Promise<AdapterCreateResult> {
        const images: string[] = [];
        const firstFrameImage = typeof params.firstFrameImage === 'string' ? params.firstFrameImage : '';
        const lastFrameImage = typeof params.lastFrameImage === 'string' ? params.lastFrameImage : '';
        const referenceImages = Array.isArray(params.referenceImages)
            ? params.referenceImages.filter((item): item is string => typeof item === 'string')
            : [];

        if (firstFrameImage) images.push(firstFrameImage);
        if (lastFrameImage) images.push(lastFrameImage);
        if (referenceImages.length > 0) images.push(...referenceImages);

        const result = await this.httpPost<Record<string, unknown>>('/v1/video/create', {
            model: params.model || 'veo3.1-fast',
            prompt: params.prompt,
            aspect_ratio: params.aspectRatio || '16:9',
            enhance_prompt: params.enhancePrompt !== false,
            enable_upsample: params.enableUpsample !== false,
            ...(images.length > 0 ? { images } : {}),
        });

        return {
            engineTaskId: typeof result.id === 'string' ? result.id : null,
            status: this.normalizeStatus(typeof result.status === 'string' ? result.status : 'queued'),
        };
    }

    async queryTask(engineTaskId: string): Promise<AdapterQueryResult> {
        const result = await this.httpGet<Record<string, unknown>>(`/v1/video/query?id=${encodeURIComponent(engineTaskId)}`);
        const nestedResult = typeof result.result === 'object' && result.result ? result.result as Record<string, unknown> : null;
        return {
            status: this.normalizeStatus(typeof result.status === 'string' ? result.status : ''),
            videoUrl: typeof result.video_url === 'string'
                ? result.video_url
                : typeof nestedResult?.video_url === 'string'
                    ? nestedResult.video_url
                    : null,
        };
    }
}
