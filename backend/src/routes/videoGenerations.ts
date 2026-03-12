import { Response, Router } from 'express';
import {
    VIDEO_FAMILIES,
    VideoFamilyDefinition,
    VideoFieldDefinition,
    VideoFieldOption,
} from '../constants/videoGenerationFamilies';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/error';

const router = Router();

const YUNWU_BASE_URL = 'https://yunwu.ai';
const YUNWU_MODELS_PATH = '/v1/models';
const MAX_REMOTE_ASSET_BYTES = 20 * 1024 * 1024;
const VERIFIED_AT = '2026-03-12';

type VerificationState = 'working' | 'blocked' | 'partial' | 'submission_only';
type SupportState = 'supported' | 'not_listed';

interface VerificationSummary {
    state: VerificationState;
    summary: string;
    testedAt: string;
}

interface EnrichedVideoFamily extends VideoFamilyDefinition {
    supportState: SupportState;
    supportedModels: string[];
    verification: VerificationSummary;
}

interface UpstreamRequestConfig {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string | FormData | ArrayBuffer | null;
}

interface UpstreamResponsePayload {
    ok: boolean;
    status: number;
    statusText: string;
    data: unknown;
}

const FAMILY_MODEL_MATCHERS: Record<string, RegExp[]> = {
    unified: [/^veo/i, /^grok-video/i],
    'openai-official': [/^sora-/i, /^veo_/i],
    hailuo: [/^MiniMax-Hailuo/i],
    'runway-image': [/^runwayml-/i],
    'kling-text': [/^kling/i],
    'kling-image': [/^kling/i],
    'vidu-text': [/^vidu/i, /^viduq/i],
    'vidu-image': [/^vidu/i, /^viduq/i],
    'vidu-reference': [/^vidu/i, /^viduq/i],
    'vidu-start-end': [/^vidu/i, /^viduq/i],
    'wan-image': [/^wan/i],
    'tencent-aigc': [/^kling/i],
};

const DYNAMIC_MODEL_OPTION_FAMILIES = new Set([
    'unified',
    'openai-official',
    'hailuo',
    'vidu-text',
    'vidu-image',
    'vidu-reference',
    'vidu-start-end',
    'wan-image',
]);

const VERIFIED_STATUS_BY_FAMILY: Record<string, VerificationSummary> = {
    unified: {
        state: 'working',
        summary: 'Veo 3.1 Fast 已验证可提交和查询；Grok Video 3-10s 手动重试后可提交。',
        testedAt: VERIFIED_AT,
    },
    'openai-official': {
        state: 'blocked',
        summary: 'Sora 2 官方视频接口当前返回上游代理超时，暂不可用。',
        testedAt: VERIFIED_AT,
    },
    hailuo: {
        state: 'working',
        summary: 'MiniMax Hailuo 02 已验证可提交和查询。',
        testedAt: VERIFIED_AT,
    },
    'runway-image': {
        state: 'working',
        summary: 'Runway Gen4 Turbo 图生视频已验证可提交和查询。',
        testedAt: VERIFIED_AT,
    },
    'kling-text': {
        state: 'working',
        summary: 'Kling 文生视频已验证可提交和查询。',
        testedAt: VERIFIED_AT,
    },
    'kling-image': {
        state: 'working',
        summary: 'Kling 图生视频已验证可提交和查询。',
        testedAt: VERIFIED_AT,
    },
    'vidu-text': {
        state: 'working',
        summary: 'VIDU 文生视频已验证可提交和查询。',
        testedAt: VERIFIED_AT,
    },
    'vidu-image': {
        state: 'working',
        summary: 'VIDU 图生视频已验证可提交和查询。',
        testedAt: VERIFIED_AT,
    },
    'vidu-reference': {
        state: 'working',
        summary: 'VIDU 参考主体视频已验证可提交和查询。',
        testedAt: VERIFIED_AT,
    },
    'vidu-start-end': {
        state: 'working',
        summary: 'VIDU 首尾帧视频已验证可提交和查询。',
        testedAt: VERIFIED_AT,
    },
    'wan-image': {
        state: 'partial',
        summary: 'Wan 图生视频可用，但 wan2.6-i2v-flash 的 480P 已验证会报 resolution_not_supported，默认应使用 720P。',
        testedAt: VERIFIED_AT,
    },
    'tencent-aigc': {
        state: 'submission_only',
        summary: '腾讯 AIGC 视频创建已返回 TaskId，查询回包仍需继续观察，先按可提交处理。',
        testedAt: VERIFIED_AT,
    },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getVideoApiKey(): string {
    const apiKey = process.env.YUNWU_VIDEO_API_KEY?.trim() || process.env.AI_API_KEY?.trim();
    if (!apiKey) {
        throw new AppError('未配置视频接口密钥，请设置 YUNWU_VIDEO_API_KEY 或 AI_API_KEY。', 500);
    }
    return apiKey;
}

function toYunwuUrl(pathname: string): string {
    return new URL(pathname, YUNWU_BASE_URL).toString();
}

function buildBearerHeaders(apiKey: string): Record<string, string> {
    return {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
    };
}

function buildJsonHeaders(apiKey: string): Record<string, string> {
    return {
        ...buildBearerHeaders(apiKey),
        'Content-Type': 'application/json',
    };
}

function optionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function requiredString(inputs: Record<string, unknown>, key: string, label = key): string {
    const value = optionalString(inputs[key]);
    if (!value) {
        throw new AppError(`${label} 为必填项。`, 400);
    }
    return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        throw new AppError(`${label} 必须是有效数字。`, 400);
    }
    return numeric;
}

function optionalBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return undefined;
}

function optionalStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    if (typeof value !== 'string') return [];

    return value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseJsonValue<T>(value: unknown, key: string, expectArray: boolean): T | undefined {
    if (value === undefined || value === null || value === '') return undefined;

    const parsed = (() => {
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch {
                throw new AppError(`${key} 不是有效的 JSON。`, 400);
            }
        }
        return value;
    })();

    if (expectArray) {
        if (!Array.isArray(parsed)) {
            throw new AppError(`${key} 必须是 JSON 数组。`, 400);
        }
        return parsed as T;
    }

    if (!isRecord(parsed)) {
        throw new AppError(`${key} 必须是 JSON 对象。`, 400);
    }
    return parsed as T;
}

function optionalJsonObject(value: unknown, key: string): Record<string, unknown> | undefined {
    return parseJsonValue<Record<string, unknown>>(value, key, false);
}

function optionalJsonArray(value: unknown, key: string): unknown[] | undefined {
    return parseJsonValue<unknown[]>(value, key, true);
}

function assertHttpUrls(values: string[], label: string): string[] {
    for (const value of values) {
        if (!/^https?:\/\//i.test(value)) {
            throw new AppError(`${label} 里必须全部是有效的 http/https 链接。`, 400);
        }
    }
    return values;
}

function maybeAssign(target: Record<string, unknown>, key: string, value: unknown) {
    if (value === undefined || value === null || value === '') return;
    target[key] = value;
}

function extractModelIds(payload: unknown): string[] {
    const items = (() => {
        if (Array.isArray(payload)) return payload;
        if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
        return [];
    })();

    return Array.from(new Set(items
        .map((item) => (isRecord(item) && typeof item.id === 'string' ? item.id : null))
        .filter((item): item is string => Boolean(item))
        .filter((item) => /(veo|grok-video|sora|hailuo|runway|kling|vidu|wan)/i.test(item))));
}

function matchFamilySupport(familyId: string, modelId: string): boolean {
    const matchers = FAMILY_MODEL_MATCHERS[familyId] || [];
    return matchers.some((matcher) => matcher.test(modelId));
}

function dedupeOptions(options: VideoFieldOption[]): VideoFieldOption[] {
    const seen = new Set<string>();
    return options.filter((option) => {
        if (seen.has(option.value)) return false;
        seen.add(option.value);
        return true;
    });
}

function buildRunwayOptions(supportedModels: string[]): VideoFieldOption[] {
    const options: VideoFieldOption[] = [];
    if (supportedModels.some((item) => /gen3a_turbo/i.test(item))) {
        options.push({ label: 'gen3a_turbo', value: 'gen3a_turbo' });
    }
    if (supportedModels.some((item) => /gen4_turbo/i.test(item))) {
        options.push({ label: 'gen4_turbo', value: 'gen4_turbo' });
    }
    return options;
}

function enrichFields(
    family: VideoFamilyDefinition,
    supportedModels: string[],
): VideoFieldDefinition[] {
    return family.fields.map((field) => {
        if (family.id === 'runway-image' && field.key === 'model') {
            const options = buildRunwayOptions(supportedModels);
            if (options.length === 0) return field;
            const defaultValue = options.some((option) => option.value === field.defaultValue)
                ? field.defaultValue
                : options[0].value;
            return { ...field, options, defaultValue };
        }

        if (!DYNAMIC_MODEL_OPTION_FAMILIES.has(family.id)) {
            return field;
        }

        if (field.key !== 'model' && field.key !== 'modelName') {
            return field;
        }

        if (supportedModels.length === 0) {
            return field;
        }

        const options = dedupeOptions(supportedModels.map((item) => ({ label: item, value: item })));
        const defaultValue = options.some((option) => option.value === field.defaultValue)
            ? field.defaultValue
            : options[0].value;

        return {
            ...field,
            options,
            defaultValue,
        };
    });
}

function enrichFamiliesWithSupport(rawModels: string[]): EnrichedVideoFamily[] {
    return VIDEO_FAMILIES.map((family) => {
        const supportedModels = rawModels.filter((modelId) => matchFamilySupport(family.id, modelId));
        return {
            ...family,
            fields: enrichFields(family, supportedModels),
            supportState: supportedModels.length > 0 ? 'supported' : 'not_listed',
            supportedModels,
            verification: VERIFIED_STATUS_BY_FAMILY[family.id] || {
                state: 'partial',
                summary: '未写入烟测结论，请手动验证。',
                testedAt: VERIFIED_AT,
            },
        };
    });
}

function fileExtensionFromMimeType(mimeType: string): string {
    switch (mimeType.toLowerCase()) {
        case 'image/jpeg':
        case 'image/jpg':
            return 'jpg';
        case 'image/webp':
            return 'webp';
        default:
            return 'png';
    }
}

async function fetchRemoteAsset(sourceUrl: string): Promise<{ blob: Blob; fileName: string }> {
    if (!/^https?:\/\//i.test(sourceUrl)) {
        throw new AppError('参考图地址必须是有效的 http/https 链接。', 400);
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) {
        throw new AppError(`拉取参考图失败，状态码：${response.status}。`, 502);
    }

    const contentLength = Number(response.headers.get('content-length') || '0');
    if (contentLength > MAX_REMOTE_ASSET_BYTES) {
        throw new AppError('参考图过大，超出允许范围。', 400);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_REMOTE_ASSET_BYTES) {
        throw new AppError('参考图过大，超出允许范围。', 400);
    }

    const mimeType = response.headers.get('content-type') || 'image/png';
    const extension = fileExtensionFromMimeType(mimeType);

    return {
        blob: new Blob([arrayBuffer], { type: mimeType }),
        fileName: `reference.${extension}`,
    };
}

async function requestUpstream(config: UpstreamRequestConfig): Promise<UpstreamResponsePayload> {
    const response = await fetch(config.url, {
        method: config.method || 'GET',
        headers: config.headers,
        body: config.body,
    });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        data,
    };
}

function getFamilyDefinition(familyId: string): VideoFamilyDefinition {
    const family = VIDEO_FAMILIES.find((item) => item.id === familyId);
    if (!family) {
        throw new AppError(`未知的视频接口家族：${familyId}`, 400);
    }
    return family;
}

function extractErrorMessage(payload: unknown): string | null {
    if (typeof payload === 'string') {
        return payload;
    }

    if (!isRecord(payload)) {
        return null;
    }

    const direct = payload.message || payload.error;
    if (typeof direct === 'string' && direct.trim()) {
        return direct;
    }

    const baseResp = payload.base_resp;
    if (isRecord(baseResp) && typeof baseResp.status_msg === 'string' && baseResp.status_msg.trim()) {
        return baseResp.status_msg;
    }

    const responseValue = payload.Response;
    if (isRecord(responseValue)) {
        const nestedMessage = responseValue.ErrorMessage || responseValue.Message;
        if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
            return nestedMessage;
        }
    }

    return null;
}

function replaceTaskId(template: string, taskId: string): string {
    return template.replace('{taskId}', encodeURIComponent(taskId));
}

function extractTaskId(familyId: string, payload: unknown): string | null {
    if (!isRecord(payload)) return null;

    switch (familyId) {
        case 'unified':
        case 'openai-official':
        case 'runway-image':
            return typeof payload.id === 'string' ? payload.id : null;
        case 'hailuo':
        case 'vidu-text':
        case 'vidu-image':
        case 'vidu-reference':
        case 'vidu-start-end':
            return typeof payload.task_id === 'string' ? payload.task_id : null;
        case 'kling-text':
        case 'kling-image':
            return isRecord(payload.data) && typeof payload.data.task_id === 'string'
                ? payload.data.task_id
                : null;
        case 'wan-image':
            return isRecord(payload.output) && typeof payload.output.task_id === 'string'
                ? payload.output.task_id
                : null;
        case 'tencent-aigc':
            return isRecord(payload.Response) && typeof payload.Response.TaskId === 'string'
                ? payload.Response.TaskId
                : null;
        default:
            return null;
    }
}

function extractStatus(familyId: string, payload: unknown): string | null {
    if (!isRecord(payload)) return null;

    switch (familyId) {
        case 'unified':
        case 'openai-official':
        case 'hailuo':
        case 'runway-image':
            return typeof payload.status === 'string' ? payload.status : null;
        case 'kling-text':
        case 'kling-image':
            if (isRecord(payload.data) && typeof payload.data.task_status === 'string') {
                return payload.data.task_status;
            }
            return null;
        case 'vidu-text':
        case 'vidu-image':
        case 'vidu-reference':
        case 'vidu-start-end':
            return typeof payload.state === 'string' ? payload.state : null;
        case 'wan-image':
            if (isRecord(payload.output) && typeof payload.output.task_status === 'string') {
                return payload.output.task_status;
            }
            return typeof payload.task_status === 'string' ? payload.task_status : null;
        case 'tencent-aigc':
            if (isRecord(payload.Response)) {
                const responsePayload = payload.Response;
                if (typeof responsePayload.Status === 'string') return responsePayload.Status;
                if (typeof responsePayload.TaskStatus === 'string') return responsePayload.TaskStatus;
                if (typeof responsePayload.State === 'string') return responsePayload.State;
                if (typeof responsePayload.TaskId === 'string') return 'submitted';
            }
            return null;
        default:
            return null;
    }
}

function findFirstVideoUrl(value: unknown, parents: string[] = []): string | null {
    if (typeof value === 'string') {
        if (!/^https?:\/\//i.test(value)) return null;
        const joined = parents.join('.').toLowerCase();
        const looksLikeVideoFile = /\.(mp4|mov|webm|m3u8)(\?|$)/i.test(value);
        const looksLikeVideoContext = /(video|media|play|download|creation|output|result)/i.test(joined)
            && !/(image|images|thumbnail|poster|cover)/i.test(joined);
        return looksLikeVideoFile || looksLikeVideoContext ? value : null;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const nested = findFirstVideoUrl(item, parents);
            if (nested) return nested;
        }
        return null;
    }

    if (!isRecord(value)) return null;

    for (const [key, nestedValue] of Object.entries(value)) {
        const nested = findFirstVideoUrl(nestedValue, [...parents, key]);
        if (nested) return nested;
    }

    return null;
}

function extractVideoUrl(_familyId: string, payload: unknown): string | null {
    return findFirstVideoUrl(payload);
}

async function buildCreateRequest(
    apiKey: string,
    familyId: string,
    inputs: Record<string, unknown>,
): Promise<UpstreamRequestConfig> {
    switch (familyId) {
        case 'unified': {
            const payload: Record<string, unknown> = {
                model: requiredString(inputs, 'model'),
                prompt: requiredString(inputs, 'prompt'),
            };
            const images = assertHttpUrls(optionalStringArray(inputs.imageUrls), 'imageUrls');
            maybeAssign(payload, 'images', images.length > 0 ? images : undefined);
            maybeAssign(payload, 'aspect_ratio', optionalString(inputs.aspectRatio));
            maybeAssign(payload, 'size', optionalString(inputs.size));
            maybeAssign(payload, 'enhance_prompt', optionalBoolean(inputs.enhancePrompt));
            maybeAssign(payload, 'enable_upsample', optionalBoolean(inputs.enableUpsample));
            return {
                url: toYunwuUrl('/v1/video/create'),
                method: 'POST',
                headers: buildJsonHeaders(apiKey),
                body: JSON.stringify(payload),
            };
        }
        case 'openai-official': {
            const formData = new FormData();
            formData.set('model', requiredString(inputs, 'model'));
            formData.set('prompt', requiredString(inputs, 'prompt'));
            formData.set('seconds', String(optionalNumber(inputs.seconds, 'seconds') ?? 5));
            formData.set('size', optionalString(inputs.size) || '16x9');
            formData.set('watermark', String(optionalBoolean(inputs.watermark) ?? false));

            const referenceImageUrl = optionalString(inputs.referenceImageUrl);
            if (referenceImageUrl) {
                const asset = await fetchRemoteAsset(referenceImageUrl);
                formData.set('input_reference', asset.blob, asset.fileName);
            }

            return {
                url: toYunwuUrl('/v1/videos'),
                method: 'POST',
                headers: buildBearerHeaders(apiKey),
                body: formData,
            };
        }
        case 'hailuo': {
            const payload: Record<string, unknown> = {
                model: requiredString(inputs, 'model'),
                prompt: requiredString(inputs, 'prompt'),
            };
            maybeAssign(payload, 'duration', optionalNumber(inputs.duration, 'duration'));
            maybeAssign(payload, 'first_frame_image', optionalString(inputs.firstFrameImage));
            maybeAssign(payload, 'last_frame_image', optionalString(inputs.lastFrameImage));
            return {
                url: toYunwuUrl('/minimax/v1/video_generation'),
                method: 'POST',
                headers: buildJsonHeaders(apiKey),
                body: JSON.stringify(payload),
            };
        }
        case 'runway-image': {
            const payload: Record<string, unknown> = {
                promptImage: requiredString(inputs, 'promptImage'),
                model: requiredString(inputs, 'model'),
                promptText: requiredString(inputs, 'promptText'),
            };
            maybeAssign(payload, 'watermark', optionalBoolean(inputs.watermark));
            maybeAssign(payload, 'duration', optionalNumber(inputs.duration, 'duration'));
            maybeAssign(payload, 'ratio', optionalString(inputs.ratio));
            return {
                url: toYunwuUrl('/runwayml/v1/image_to_video'),
                method: 'POST',
                headers: buildJsonHeaders(apiKey),
                body: JSON.stringify(payload),
            };
        }
        case 'kling-text': {
            const payload: Record<string, unknown> = {
                model_name: requiredString(inputs, 'modelName'),
                prompt: requiredString(inputs, 'prompt'),
            };
            maybeAssign(payload, 'negative_prompt', optionalString(inputs.negativePrompt));
            maybeAssign(payload, 'cfg_scale', optionalNumber(inputs.cfgScale, 'cfgScale'));
            maybeAssign(payload, 'mode', optionalString(inputs.mode));
            maybeAssign(payload, 'sound', optionalString(inputs.sound));
            maybeAssign(payload, 'aspect_ratio', optionalString(inputs.aspectRatio));
            maybeAssign(payload, 'duration', optionalString(inputs.duration));
            maybeAssign(payload, 'camera_control', optionalJsonObject(inputs.cameraControlJson, 'cameraControlJson'));
            maybeAssign(payload, 'callback_url', optionalString(inputs.callbackUrl));
            maybeAssign(payload, 'external_task_id', optionalString(inputs.externalTaskId));
            return {
                url: toYunwuUrl('/kling/v1/videos/text2video'),
                method: 'POST',
                headers: buildJsonHeaders(apiKey),
                body: JSON.stringify(payload),
            };
        }
        case 'kling-image': {
            const payload: Record<string, unknown> = {
                model_name: requiredString(inputs, 'modelName'),
                image: requiredString(inputs, 'image'),
            };
            maybeAssign(payload, 'image_tail', optionalString(inputs.imageTail));
            maybeAssign(payload, 'prompt', optionalString(inputs.prompt));
            maybeAssign(payload, 'negative_prompt', optionalString(inputs.negativePrompt));
            maybeAssign(payload, 'cfg_scale', optionalNumber(inputs.cfgScale, 'cfgScale'));
            maybeAssign(payload, 'mode', optionalString(inputs.mode));
            maybeAssign(payload, 'duration', optionalString(inputs.duration));
            maybeAssign(payload, 'static_mask', optionalString(inputs.staticMask));
            maybeAssign(payload, 'dynamic_masks', optionalJsonArray(inputs.dynamicMasksJson, 'dynamicMasksJson'));
            return {
                url: toYunwuUrl('/kling/v1/videos/image2video'),
                method: 'POST',
                headers: buildJsonHeaders(apiKey),
                body: JSON.stringify(payload),
            };
        }
        case 'vidu-text': {
            const payload: Record<string, unknown> = {
                model: requiredString(inputs, 'model'),
                prompt: requiredString(inputs, 'prompt'),
            };
            maybeAssign(payload, 'duration', optionalNumber(inputs.duration, 'duration'));
            maybeAssign(payload, 'resolution', optionalString(inputs.resolution));
            maybeAssign(payload, 'aspect_ratio', optionalString(inputs.aspectRatio));
            maybeAssign(payload, 'movement_amplitude', optionalString(inputs.movementAmplitude));
            maybeAssign(payload, 'audio', optionalBoolean(inputs.audio));
            maybeAssign(payload, 'bgm', optionalBoolean(inputs.bgm));
            maybeAssign(payload, 'watermark', optionalBoolean(inputs.watermark));
            maybeAssign(payload, 'off_peak', optionalBoolean(inputs.offPeak));
            maybeAssign(payload, 'payload', optionalString(inputs.payload));
            maybeAssign(payload, 'client_request_id', optionalString(inputs.clientRequestId));
            return {
                url: toYunwuUrl('/ent/v2/text2video'),
                method: 'POST',
                headers: buildJsonHeaders(apiKey),
                body: JSON.stringify(payload),
            };
        }
        case 'vidu-image': {
            const imageUrls = assertHttpUrls(optionalStringArray(inputs.imageUrls), 'imageUrls');
            if (imageUrls.length === 0) {
                throw new AppError('imageUrls 为必填项。', 400);
            }
            const payload: Record<string, unknown> = {
                model: requiredString(inputs, 'model'),
                images: imageUrls,
            };
            maybeAssign(payload, 'prompt', optionalString(inputs.prompt));
            maybeAssign(payload, 'duration', optionalNumber(inputs.duration, 'duration'));
            maybeAssign(payload, 'resolution', optionalString(inputs.resolution));
            maybeAssign(payload, 'aspect_ratio', optionalString(inputs.aspectRatio));
            maybeAssign(payload, 'movement_amplitude', optionalString(inputs.movementAmplitude));
            maybeAssign(payload, 'audio', optionalBoolean(inputs.audio));
            maybeAssign(payload, 'bgm', optionalBoolean(inputs.bgm));
            maybeAssign(payload, 'watermark', optionalBoolean(inputs.watermark));
            maybeAssign(payload, 'off_peak', optionalBoolean(inputs.offPeak));
            return {
                url: toYunwuUrl('/ent/v2/img2video'),
                method: 'POST',
                headers: buildJsonHeaders(apiKey),
                body: JSON.stringify(payload),
            };
        }
        case 'vidu-reference': {
            const payload: Record<string, unknown> = {
                model: requiredString(inputs, 'model'),
                prompt: requiredString(inputs, 'prompt'),
                subjects: parseJsonValue<unknown[]>(inputs.subjectsJson, 'subjectsJson', true),
            };
            maybeAssign(payload, 'duration', optionalNumber(inputs.duration, 'duration'));
            maybeAssign(payload, 'resolution', optionalString(inputs.resolution));
            maybeAssign(payload, 'aspect_ratio', optionalString(inputs.aspectRatio));
            maybeAssign(payload, 'movement_amplitude', optionalString(inputs.movementAmplitude));
            return {
                url: toYunwuUrl('/ent/v2/reference2video'),
                method: 'POST',
                headers: buildJsonHeaders(apiKey),
                body: JSON.stringify(payload),
            };
        }
        case 'vidu-start-end': {
            const imageUrls = assertHttpUrls(optionalStringArray(inputs.imageUrls), 'imageUrls');
            if (imageUrls.length < 2) {
                throw new AppError('VIDU 首尾帧模式至少需要两张图片链接。', 400);
            }
            const payload: Record<string, unknown> = {
                model: requiredString(inputs, 'model'),
                images: imageUrls.slice(0, 2),
            };
            maybeAssign(payload, 'prompt', optionalString(inputs.prompt));
            maybeAssign(payload, 'duration', optionalNumber(inputs.duration, 'duration'));
            maybeAssign(payload, 'resolution', optionalString(inputs.resolution));
            maybeAssign(payload, 'movement_amplitude', optionalString(inputs.movementAmplitude));
            return {
                url: toYunwuUrl('/ent/v2/start-end2video'),
                method: 'POST',
                headers: buildJsonHeaders(apiKey),
                body: JSON.stringify(payload),
            };
        }
        case 'wan-image': {
            const parameters: Record<string, unknown> = {};
            maybeAssign(parameters, 'resolution', optionalString(inputs.resolution));
            maybeAssign(parameters, 'prompt_extend', optionalBoolean(inputs.promptExtend));
            maybeAssign(parameters, 'audio', optionalBoolean(inputs.audio));
            maybeAssign(parameters, 'duration', optionalNumber(inputs.duration, 'duration'));
            return {
                url: toYunwuUrl('/alibailian/api/v1/services/aigc/video-generation/video-synthesis'),
                method: 'POST',
                headers: buildJsonHeaders(apiKey),
                body: JSON.stringify({
                    model: requiredString(inputs, 'model'),
                    input: {
                        prompt: requiredString(inputs, 'prompt'),
                        img_url: requiredString(inputs, 'imageUrl'),
                    },
                    parameters,
                }),
            };
        }
        case 'tencent-aigc': {
            const outputConfig: Record<string, unknown> = {};
            maybeAssign(outputConfig, 'storage_mode', optionalString(inputs.storageMode));
            maybeAssign(outputConfig, 'media_name', optionalString(inputs.mediaName));
            maybeAssign(outputConfig, 'duration', optionalNumber(inputs.duration, 'duration'));
            maybeAssign(outputConfig, 'resolution', optionalString(inputs.resolution));
            maybeAssign(outputConfig, 'aspect_ratio', optionalString(inputs.aspectRatio));
            maybeAssign(outputConfig, 'audio_generation', optionalString(inputs.audioGeneration));
            maybeAssign(outputConfig, 'person_generation', optionalString(inputs.personGeneration));
            maybeAssign(outputConfig, 'input_compliance_check', optionalString(inputs.inputComplianceCheck));
            maybeAssign(outputConfig, 'output_compliance_check', optionalString(inputs.outputComplianceCheck));
            maybeAssign(outputConfig, 'enhance_switch', optionalString(inputs.enhanceSwitch));

            const payload: Record<string, unknown> = {
                model_name: requiredString(inputs, 'modelName'),
                model_version: requiredString(inputs, 'modelVersion'),
                prompt: requiredString(inputs, 'prompt'),
                output_config: outputConfig,
            };
            maybeAssign(payload, 'negative_prompt', optionalString(inputs.negativePrompt));
            maybeAssign(payload, 'enhance_prompt', optionalString(inputs.enhancePromptMode));
            return {
                url: toYunwuUrl('/tencent-vod/v1/aigc-video'),
                method: 'POST',
                headers: buildJsonHeaders(apiKey),
                body: JSON.stringify(payload),
            };
        }
        default:
            throw new AppError(`暂不支持该视频接口家族：${familyId}`, 400);
    }
}

function buildQueryRequest(apiKey: string, familyId: string, taskId: string): UpstreamRequestConfig {
    const family = getFamilyDefinition(familyId);
    if (!family.queryPathTemplate) {
        throw new AppError(`当前接口家族不支持查询：${familyId}`, 400);
    }

    return {
        url: toYunwuUrl(replaceTaskId(family.queryPathTemplate, taskId)),
        method: 'GET',
        headers: buildBearerHeaders(apiKey),
    };
}

router.get('/models', async (_req, res: Response) => {
    const apiKey = getVideoApiKey();
    const upstream = await requestUpstream({
        url: toYunwuUrl(YUNWU_MODELS_PATH),
        method: 'GET',
        headers: {
            Authorization: apiKey,
            Accept: 'application/json',
        },
    });

    if (!upstream.ok) {
        return res.status(upstream.status).json({
            success: false,
            message: extractErrorMessage(upstream.data) || '加载云雾模型列表失败。',
            data: upstream.data,
        });
    }

    const rawModels = extractModelIds(upstream.data);
    const families = enrichFamiliesWithSupport(rawModels);

    res.json({
        success: true,
        data: {
            rawModels,
            families,
        },
    });
});

router.use(authMiddleware);

router.post('/generate', async (req: AuthRequest, res: Response) => {
    if (!req.userId) {
        throw new AppError('未登录或登录已失效。', 401);
    }

    const body = isRecord(req.body) ? req.body : {};
    const familyId = requiredString(body, 'familyId');
    const inputs = isRecord(body.inputs) ? body.inputs : {};
    const apiKey = getVideoApiKey();

    const createRequest = await buildCreateRequest(apiKey, familyId, inputs);
    const create = await requestUpstream(createRequest);
    const taskId = extractTaskId(familyId, create.data);

    if (!create.ok) {
        return res.status(create.status).json({
            success: false,
            message: extractErrorMessage(create.data) || '视频生成请求失败。',
            data: {
                familyId,
                taskId,
                create,
            },
        });
    }

    if (!taskId) {
        return res.status(502).json({
            success: false,
            message: '上游已接受请求，但没有返回任务 ID。',
            data: {
                familyId,
                create,
            },
        });
    }

    let latest: UpstreamResponsePayload | null = null;
    let latestError: string | null = null;

    try {
        latest = await requestUpstream(buildQueryRequest(apiKey, familyId, taskId));
        if (!latest.ok) {
            latestError = extractErrorMessage(latest.data) || `查询任务状态失败，状态码：${latest.status}。`;
        }
    } catch (error) {
        latestError = error instanceof Error ? error.message : '查询任务状态失败。';
    }

    const effectivePayload = latest?.data ?? create.data;
    const status = extractStatus(familyId, effectivePayload);
    const videoUrl = extractVideoUrl(familyId, effectivePayload);

    res.json({
        success: true,
        data: {
            familyId,
            taskId,
            create,
            latest,
            latestError,
            status,
            videoUrl,
        },
    });
});

router.get('/status', async (req: AuthRequest, res: Response) => {
    if (!req.userId) {
        throw new AppError('未登录或登录已失效。', 401);
    }

    const familyId = typeof req.query.familyId === 'string' ? req.query.familyId.trim() : '';
    const taskId = typeof req.query.taskId === 'string' ? req.query.taskId.trim() : '';

    if (!familyId) {
        throw new AppError('familyId 为必填项。', 400);
    }
    if (!taskId) {
        throw new AppError('taskId 为必填项。', 400);
    }

    const apiKey = getVideoApiKey();
    const query = await requestUpstream(buildQueryRequest(apiKey, familyId, taskId));

    if (!query.ok) {
        return res.status(query.status).json({
            success: false,
            message: extractErrorMessage(query.data) || '视频任务状态查询失败。',
            data: {
                familyId,
                taskId,
                query,
            },
        });
    }

    res.json({
        success: true,
        data: {
            familyId,
            taskId,
            query,
            status: extractStatus(familyId, query.data),
            videoUrl: extractVideoUrl(familyId, query.data),
        },
    });
});

export default router;
