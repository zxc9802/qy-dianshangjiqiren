export const VIDEO_SITE_KEYS = ['seedance'] as const;

export type VideoSiteKey = (typeof VIDEO_SITE_KEYS)[number];

export const VIDEO_SITE_METADATA = {
    seedance: {
        key: 'seedance',
        name: '视频工作台',
        shortName: '视频工作台',
        entryPath: '/bot/video-workbench',
        defaultAppUrl: 'https://disanfang.qyaijingxuan.top',
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

export function parseVideoSiteKey(value: unknown, fallback: VideoSiteKey = 'seedance'): VideoSiteKey {
    return isVideoSiteKey(value) ? value : fallback;
}
