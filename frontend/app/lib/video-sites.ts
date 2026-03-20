export const VIDEO_SITE_KEYS = ['veo', 'seedance'] as const;

export type VideoSiteKey = (typeof VIDEO_SITE_KEYS)[number];

export const VIDEO_SITE_METADATA = {
    veo: {
        key: 'veo',
        name: 'VEO 视频工作台',
        shortName: 'VEO',
        entryPath: '/bot/video-workbench',
        defaultAppUrl: 'https://spgzt.qyaijingxuan.top',
    },
    seedance: {
        key: 'seedance',
        name: 'Seedance 2.0 视频工作台',
        shortName: 'Seedance 2.0',
        entryPath: '/bot/video-workbench-seedance',
        defaultAppUrl: 'https://seeda.zeabur.app',
    },
} as const satisfies Record<VideoSiteKey, {
    key: VideoSiteKey;
    name: string;
    shortName: string;
    entryPath: string;
    defaultAppUrl: string;
}>;

export function isVideoSiteKey(value: unknown): value is VideoSiteKey {
    return typeof value === 'string' && VIDEO_SITE_KEYS.includes(value as VideoSiteKey);
}

export function parseVideoSiteKey(value: unknown, fallback: VideoSiteKey = 'veo'): VideoSiteKey {
    return isVideoSiteKey(value) ? value : fallback;
}
