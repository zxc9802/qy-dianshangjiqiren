import type { NextRequest } from 'next/server';
import { getBuyerShowAppUrl } from './buyer-show-sso';
import { getCopywritingAgentAppUrl } from './copywriting-agent-sso';
import { getDetailImageAgentAppUrl } from './detail-image-agent-sso';
import { getKbChatAppUrl } from './kb-chat-sso';
import { getAllVideoAppUrls } from './video-sso';

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

function mergeHeaders(base: Headers, input?: HeadersInit) {
    if (!input) return;

    const incoming = new Headers(input);
    incoming.forEach((value, key) => {
        base.set(key, value);
    });
}

function toOrigin(value: string): string | null {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

function getConfiguredSsoClientUrls(): string[] {
    return [
        ...getAllVideoAppUrls(),
        getCopywritingAgentAppUrl(),
        getDetailImageAgentAppUrl(),
        getBuyerShowAppUrl(),
        getKbChatAppUrl(),
    ];
}

export function isAllowedSsoClientOrigin(origin: string | null): boolean {
    if (!origin) {
        return false;
    }

    try {
        const candidate = new URL(origin);
        for (const configuredUrl of getConfiguredSsoClientUrls()) {
            if (candidate.origin === toOrigin(configuredUrl)) {
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

export function buildSsoClientCorsHeaders(origin: string | null): Headers {
    const headers = new Headers();
    headers.set('Vary', 'Origin');

    if (!isAllowedSsoClientOrigin(origin)) {
        return headers;
    }

    headers.set('Access-Control-Allow-Origin', origin!);
    headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Max-Age', '86400');

    return headers;
}

export function withSsoClientCors(response: Response, origin: string | null): Response {
    const headers = new Headers(response.headers);
    mergeHeaders(headers, buildSsoClientCorsHeaders(origin));

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

export function jsonWithSsoClientCors(
    body: unknown,
    init: ResponseInit | undefined,
    origin: string | null,
) {
    const headers = buildSsoClientCorsHeaders(origin);
    mergeHeaders(headers, init?.headers);

    return Response.json(body, {
        ...init,
        headers,
    });
}

export function createSsoClientPreflightResponse(req: NextRequest) {
    const origin = req.headers.get('origin');
    if (!isAllowedSsoClientOrigin(origin)) {
        return new Response(null, { status: 403 });
    }

    return new Response(null, {
        status: 204,
        headers: buildSsoClientCorsHeaders(origin),
    });
}
