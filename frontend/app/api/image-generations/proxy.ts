import { NextRequest } from 'next/server';
import { readBackendUrl } from '../../lib/server-env';

const BACKEND_IMAGE_API_PREFIX = '/api/image-assets/';
const LEGACY_FRONTEND_IMAGE_PREFIX = '/generated-images/';
const FRONTEND_IMAGE_PROXY_PREFIX = '/api/image-assets/';
const FRONTEND_LEGACY_IMAGE_PROXY_PREFIX = '/api/generated-images/';

function buildTargetUrl(req: NextRequest, pathSegments: string[] = []): string {
    const backendUrl = readBackendUrl();
    const suffix = pathSegments.length > 0 ? `/${pathSegments.join('/')}` : '';
    return `${backendUrl}/api/image-generations${suffix}${req.nextUrl.search}`;
}

function copyRequestHeaders(req: NextRequest, includeContentType: boolean): Headers {
    const headers = new Headers();
    const authorization = req.headers.get('authorization');
    const accept = req.headers.get('accept');
    const contentType = req.headers.get('content-type');

    if (authorization) headers.set('authorization', authorization);
    if (accept) headers.set('accept', accept);
    if (includeContentType && contentType) headers.set('content-type', contentType);

    return headers;
}

function toFrontendServedAssetUrl(value: string): string {
    if (!value) return value;

    if (value.startsWith(BACKEND_IMAGE_API_PREFIX)) {
        return `${FRONTEND_IMAGE_PROXY_PREFIX}${value.slice(BACKEND_IMAGE_API_PREFIX.length)}`;
    }

    if (value.startsWith(LEGACY_FRONTEND_IMAGE_PREFIX)) {
        return `${FRONTEND_LEGACY_IMAGE_PROXY_PREFIX}${value.slice(LEGACY_FRONTEND_IMAGE_PREFIX.length)}`;
    }

    if (!/^https?:\/\//i.test(value)) {
        return value;
    }

    try {
        const url = new URL(value);
        if (url.pathname.startsWith(BACKEND_IMAGE_API_PREFIX)) {
            return `${FRONTEND_IMAGE_PROXY_PREFIX}${url.pathname.slice(BACKEND_IMAGE_API_PREFIX.length)}${url.search}`;
        }
        if (url.pathname.startsWith(LEGACY_FRONTEND_IMAGE_PREFIX)) {
            return `${FRONTEND_LEGACY_IMAGE_PROXY_PREFIX}${url.pathname.slice(LEGACY_FRONTEND_IMAGE_PREFIX.length)}${url.search}`;
        }
        return value;
    } catch {
        return value;
    }
}

function normalizeImageGenerationRecord(record: unknown): unknown {
    if (!record || typeof record !== 'object') return record;

    const candidate = record as Record<string, unknown>;
    const next: Record<string, unknown> = { ...candidate };

    if (typeof candidate.referenceImagePath === 'string') {
        next.referenceImagePath = toFrontendServedAssetUrl(candidate.referenceImagePath);
    }

    if (Array.isArray(candidate.resultImagePaths)) {
        next.resultImagePaths = candidate.resultImagePaths.map((item) => (
            typeof item === 'string' ? toFrontendServedAssetUrl(item) : item
        ));
    }

    return next;
}

async function normalizeImageGenerationResponse(upstream: Response): Promise<Response> {
    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const body = await upstream.arrayBuffer();
        return new Response(body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: upstream.headers,
        });
    }

    const payload = await upstream.json() as Record<string, unknown>;
    const nextPayload: Record<string, unknown> = { ...payload };
    const data = payload.data;

    if (Array.isArray((data as Record<string, unknown> | undefined)?.items)) {
        const record = data as Record<string, unknown>;
        nextPayload.data = {
            ...record,
            items: (record.items as unknown[]).map((item) => normalizeImageGenerationRecord(item)),
        };
    } else {
        nextPayload.data = normalizeImageGenerationRecord(data);
    }

    return Response.json(nextPayload, {
        status: upstream.status,
        statusText: upstream.statusText,
    });
}

export async function proxyImageGenerationRequest(req: NextRequest, pathSegments: string[] = []): Promise<Response> {
    const targetUrl = buildTargetUrl(req, pathSegments);
    const headers = copyRequestHeaders(req, true);
    const body = req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : await req.arrayBuffer();

    try {
        const upstream = await fetch(targetUrl, {
            method: req.method,
            headers,
            body: body && body.byteLength > 0 ? body : undefined,
            cache: 'no-store',
        });

        return normalizeImageGenerationResponse(upstream);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Image generation service unavailable';
        return Response.json({ success: false, message }, { status: 502 });
    }
}

function fileExtensionFromMimeType(mimeType: string): string {
    switch (mimeType.toLowerCase()) {
        case 'image/jpeg':
        case 'image/jpg':
            return 'jpg';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        default:
            return 'png';
    }
}

export async function proxyGenerateImageRequest(req: NextRequest): Promise<Response> {
    const headers = copyRequestHeaders(req, false);
    const backendUrl = readBackendUrl();
    const targetUrl = `${backendUrl}/api/image-generations/generate`;

    try {
        const body = await req.json() as Record<string, unknown>;
        const formData = new FormData();

        const scalarKeys = [
            'prompt',
            'negativePrompt',
            'aspectRatio',
            'stylePreset',
            'background',
            'lighting',
            'referenceStrength',
            'count',
        ] as const;

        for (const key of scalarKeys) {
            const value = body[key];
            if (value === undefined || value === null || value === '') continue;
            formData.set(key, String(value));
        }

        const referenceImage = body.referenceImage;
        const referenceImageMime = body.referenceImageMime;
        if (typeof referenceImage === 'string' && referenceImage && typeof referenceImageMime === 'string' && referenceImageMime) {
            const extension = fileExtensionFromMimeType(referenceImageMime);
            const blob = new Blob([Buffer.from(referenceImage, 'base64')], { type: referenceImageMime });
            formData.set('referenceImage', blob, `reference.${extension}`);
        }

        const upstream = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body: formData,
            cache: 'no-store',
        });

        return normalizeImageGenerationResponse(upstream);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Image generation request failed';
        return Response.json({ success: false, message }, { status: 502 });
    }
}
