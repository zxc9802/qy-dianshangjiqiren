import { NextRequest } from 'next/server';
import { readBackendUrl } from '../../lib/server-env';

function buildTargetUrl(req: NextRequest, pathSegments: string[] = []): string {
    const backendUrl = readBackendUrl();
    const suffix = pathSegments.length > 0 ? `/${pathSegments.join('/')}` : '';
    return `${backendUrl}/api/video-generations${suffix}${req.nextUrl.search}`;
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

export async function proxyVideoGenerationRequest(
    req: NextRequest,
    pathSegments: string[] = [],
): Promise<Response> {
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

        const contentType = upstream.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const payload = await upstream.json();
            return Response.json(payload, {
                status: upstream.status,
                statusText: upstream.statusText,
            });
        }

        const payload = await upstream.arrayBuffer();
        return new Response(payload, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: upstream.headers,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Video generation service unavailable';
        return Response.json({ success: false, message }, { status: 502 });
    }
}
