import type { NextRequest } from 'next/server';
import { getAllVideoAppUrls } from './video-sso';

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

function mergeHeaders(base: Headers, input?: HeadersInit) {
    if (!input) return;

    const incoming = new Headers(input);
    incoming.forEach((value, key) => {
        base.set(key, value);
    });
}

export function isAllowedVideoClientOrigin(origin: string | null): boolean {
    if (!origin) {
        return false;
    }

    try {
        const candidate = new URL(origin);
        for (const configuredUrl of getAllVideoAppUrls()) {
            const configured = new URL(configuredUrl);
            if (candidate.origin === configured.origin) {
                return true;
            }
        }

        if (process.env.NODE_ENV !== 'production' && LOCAL_DEV_HOSTS.has(candidate.hostname)) {
            return true;
        }
    } catch {
        return false;
    }

    return false;
}

export function buildVideoClientCorsHeaders(origin: string | null): Headers {
    const headers = new Headers();
    headers.set('Vary', 'Origin');

    if (!isAllowedVideoClientOrigin(origin)) {
        return headers;
    }

    headers.set('Access-Control-Allow-Origin', origin!);
    headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Max-Age', '86400');

    return headers;
}

export function withVideoClientCors(response: Response, origin: string | null): Response {
    const headers = new Headers(response.headers);
    mergeHeaders(headers, buildVideoClientCorsHeaders(origin));

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

export function jsonWithVideoClientCors(
    body: unknown,
    init: ResponseInit | undefined,
    origin: string | null,
) {
    const headers = buildVideoClientCorsHeaders(origin);
    mergeHeaders(headers, init?.headers);

    return Response.json(body, {
        ...init,
        headers,
    });
}

export function createVideoClientPreflightResponse(req: NextRequest) {
    const origin = req.headers.get('origin');
    if (!isAllowedVideoClientOrigin(origin)) {
        return new Response(null, { status: 403 });
    }

    return new Response(null, {
        status: 204,
        headers: buildVideoClientCorsHeaders(origin),
    });
}
