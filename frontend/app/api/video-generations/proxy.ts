import { NextRequest } from 'next/server';
import { readBackendUrl } from '../../lib/server-env';

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

async function readUpstreamPayload(upstream: Response): Promise<{
    body: BodyInit | null;
    isJson: boolean;
    json: unknown | null;
}> {
    const contentType = upstream.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (!isJson) {
        const body = await upstream.arrayBuffer();
        return { body, isJson: false, json: null };
    }

    const text = await upstream.text();
    if (!text.trim()) {
        return { body: null, isJson: true, json: null };
    }

    try {
        return { body: text, isJson: true, json: JSON.parse(text) };
    } catch {
        return { body: text, isJson: false, json: null };
    }
}

async function normalizeProxyResponse(upstream: Response): Promise<Response> {
    const payload = await readUpstreamPayload(upstream);
    if (!payload.isJson) {
        return new Response(payload.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: upstream.headers,
        });
    }

    return Response.json(payload.json ?? {}, {
        status: upstream.status,
        statusText: upstream.statusText,
    });
}

export async function proxyVideoGenerationFormRequest(req: NextRequest, suffix: string): Promise<Response> {
    const targetUrl = `${readBackendUrl()}/api/video-generations/${suffix}${req.nextUrl.search}`;
    const headers = copyRequestHeaders(req, false);

    try {
        const formData = await req.formData();
        const upstream = await fetch(targetUrl, {
            method: req.method,
            headers,
            body: formData,
            cache: 'no-store',
        });

        return await normalizeProxyResponse(upstream);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Video generation service unavailable';
        const isBadUploadPayload = message.includes('Content-Type was not one of');
        return Response.json(
            {
                success: false,
                message: isBadUploadPayload ? 'Invalid upload payload. Please refresh the page and try again.' : message,
            },
            { status: isBadUploadPayload ? 400 : 502 },
        );
    }
}

export async function proxyVideoGenerationRequest(req: NextRequest, suffix: string): Promise<Response> {
    const targetUrl = `${readBackendUrl()}/api/video-generations/${suffix}${req.nextUrl.search}`;
    const headers = copyRequestHeaders(req, false);

    try {
        const upstream = await fetch(targetUrl, {
            method: req.method,
            headers,
            cache: 'no-store',
        });

        return await normalizeProxyResponse(upstream);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Video generation service unavailable';
        return Response.json({ success: false, message }, { status: 502 });
    }
}
