import { NextRequest } from 'next/server';
import { readBackendUrl } from '../../lib/server-env';

function buildTargetUrl(req: NextRequest, pathSegments: string[]): string {
    const backendUrl = readBackendUrl();
    const suffix = pathSegments.length > 0 ? `/${pathSegments.join('/')}` : '';
    return `${backendUrl}/api/custom-bots${suffix}${req.nextUrl.search}`;
}

export async function proxyCustomBotRequest(req: NextRequest, pathSegments: string[]): Promise<Response> {
    const targetUrl = buildTargetUrl(req, pathSegments);

    const headers = new Headers();
    const authorization = req.headers.get('authorization');
    const contentType = req.headers.get('content-type');
    const accept = req.headers.get('accept');

    if (authorization) headers.set('authorization', authorization);
    if (contentType) headers.set('content-type', contentType);
    if (accept) headers.set('accept', accept);

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

        const responseHeaders = new Headers();
        const responseType = upstream.headers.get('content-type');
        if (responseType) {
            responseHeaders.set('content-type', responseType);
        }

        const responseText = await upstream.text();
        responseHeaders.set('content-length', Buffer.byteLength(responseText).toString());

        return new Response(responseText, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: responseHeaders,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Custom bot service unavailable';
        return Response.json(
            { success: false, message },
            { status: 502 },
        );
    }
}
