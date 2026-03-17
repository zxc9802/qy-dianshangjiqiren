import type { BaseAdapter } from './base';
import { HailuoAdapter } from './hailuo';
import { KlingAdapter } from './kling';
import { RunwayAdapter } from './runway';
import { VeoAdapter } from './veo';
import { WanAdapter } from './wan';
import type { VideoBotConfigMap, VideoBotEngineId } from '../types';

export const ENGINE_CAPABILITIES: VideoBotConfigMap = {
    veo: {
        name: 'Veo',
        label: 'Veo',
        color: '#4285F4',
        models: [
            { value: 'veo3.1', label: 'Veo 3.1' },
            { value: 'veo3.1-fast', label: 'Veo 3.1 Fast' },
        ],
        modes: ['text2video', 'image2video', 'keyframe'],
        params: {
            aspectRatio: ['16:9', '9:16', '1:1'],
            duration: false,
            resolution: false,
            enhancePrompt: true,
            enableUpsample: true,
            cameraMotion: false,
            negativePrompt: false,
            watermark: false,
            audio: false,
        },
        modeParams: {},
    },
    runway: {
        name: 'Runway',
        label: 'Runway',
        color: '#00D4AA',
        models: [{ value: 'gen4_turbo', label: 'Gen-4 Turbo' }],
        modes: ['text2video', 'image2video'],
        params: {
            aspectRatio: ['16:9', '9:16', '1:1'],
            duration: [5, 10],
            resolution: false,
            enhancePrompt: false,
            enableUpsample: false,
            cameraMotion: false,
            negativePrompt: false,
            watermark: true,
            audio: false,
        },
        modeParams: {
            image2video: { aspectRatio: false },
        },
    },
    wan: {
        name: 'Wan',
        label: 'Wan',
        color: '#722ED1',
        models: [{ value: 'wan2.5-i2v-preview', label: 'Wan 2.5 I2V' }],
        modes: ['text2video', 'image2video', 'keyframe'],
        params: {
            aspectRatio: false,
            duration: [5],
            resolution: ['720P', '1080P'],
            enhancePrompt: true,
            enableUpsample: false,
            cameraMotion: false,
            negativePrompt: false,
            watermark: false,
            audio: false,
        },
        modeModels: {
            text2video: [{ value: 'wan2.5-i2v-preview', label: 'Wan 2.5 I2V' }],
            image2video: [{ value: 'wan2.5-i2v-preview', label: 'Wan 2.5 I2V' }],
            keyframe: [{ value: 'wan2.2-kf2v-flash', label: 'Wan 2.2 KF2V Flash' }],
        },
        modeParams: {
            text2video: { aspectRatio: ['16:9', '9:16', '1:1'], duration: [5, 10], resolution: ['720P', '1080P'] },
            image2video: { aspectRatio: false, duration: [5], resolution: ['720P', '1080P'] },
            keyframe: { aspectRatio: false, duration: [5], resolution: ['480P', '720P', '1080P'] },
        },
    },
    kling: {
        name: 'Kling',
        label: 'Kling',
        color: '#EB2F96',
        models: [
            { value: 'kling-v3', label: 'Kling V3' },
            { value: 'kling-v2-master', label: 'Kling V2 Master' },
            { value: 'kling-v2-5-turbo', label: 'Kling V2.5 Turbo' },
        ],
        modes: ['text2video', 'image2video', 'keyframe', 'video2video'],
        params: {
            aspectRatio: ['16:9', '9:16', '1:1'],
            duration: [5, 10],
            resolution: false,
            enhancePrompt: false,
            enableUpsample: false,
            cameraMotion: ['simple', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down'],
            negativePrompt: true,
            watermark: false,
            audio: false,
        },
        modeParams: {
            image2video: { aspectRatio: false },
            keyframe: { aspectRatio: false },
            video2video: { aspectRatio: false },
        },
    },
    hailuo: {
        name: 'Hailuo',
        label: 'Hailuo',
        color: '#00BFA5',
        models: [{ value: 'MiniMax-Hailuo-2.3', label: 'Hailuo 2.3' }],
        modes: ['text2video', 'image2video', 'keyframe'],
        params: {
            aspectRatio: false,
            duration: [6, 10],
            resolution: ['768P', '1080P'],
            enhancePrompt: true,
            enableUpsample: false,
            cameraMotion: false,
            negativePrompt: false,
            watermark: false,
            audio: false,
        },
        modeParams: {},
    },
};

export function getAdapter(engine: VideoBotEngineId, apiKey: string): BaseAdapter {
    switch (engine) {
        case 'veo':
            return new VeoAdapter(apiKey);
        case 'runway':
            return new RunwayAdapter(apiKey);
        case 'wan':
            return new WanAdapter(apiKey);
        case 'kling':
            return new KlingAdapter(apiKey);
        case 'hailuo':
            return new HailuoAdapter(apiKey);
    }

    throw new Error(`Unknown engine: ${engine}`);
}
