import { BaseAdapter } from './base';
import type { AdapterCreateResult, AdapterQueryResult } from '../types';

function convertRatio(ratio: string | undefined): string {
    const map: Record<string, string> = {
        '16:9': '1280:768',
        '9:16': '768:1280',
        '1:1': '1024:1024',
    };
    return map[ratio ?? ''] || '1280:768';
}

export class RunwayAdapter extends BaseAdapter {
    async createTask(params: Record<string, unknown>): Promise<AdapterCreateResult> {
        const firstFrameImage = typeof params.firstFrameImage === 'string' ? params.firstFrameImage : '';
        const result = await this.httpPost<Record<string, unknown>>('/runwayml/v1/image_to_video', {
            model: params.model || 'gen4_turbo',
            promptText: params.prompt,
            duration: params.duration || 5,
            ratio: convertRatio(typeof params.aspectRatio === 'string' ? params.aspectRatio : undefined),
            watermark: params.watermark === true,
            ...(firstFrameImage ? { promptImage: firstFrameImage } : {}),
        });

        return {
            engineTaskId: typeof result.id === 'string' ? result.id : null,
            status: this.normalizeStatus(typeof result.state === 'string' ? result.state : typeof result.status === 'string' ? result.status : 'queued'),
        };
    }

    async queryTask(engineTaskId: string): Promise<AdapterQueryResult> {
        const result = await this.httpGet<Record<string, unknown>>(`/runwayml/v1/tasks/${encodeURIComponent(engineTaskId)}`);
        const output = Array.isArray(result.output) ? result.output : [];
        return {
            status: this.normalizeStatus(typeof result.state === 'string' ? result.state : typeof result.status === 'string' ? result.status : ''),
            videoUrl: typeof result.video === 'string'
                ? result.video
                : typeof output[0] === 'string'
                    ? output[0]
                    : null,
        };
    }
}
