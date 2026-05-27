import type { NextRequest } from 'next/server';
import {
    buildSsoClientCorsHeaders,
    createSsoClientPreflightResponse,
    isAllowedSsoClientOrigin,
    jsonWithSsoClientCors,
    withSsoClientCors,
} from './sso-client-cors';

export function isAllowedVideoClientOrigin(origin: string | null): boolean {
    return isAllowedSsoClientOrigin(origin);
}

export function buildVideoClientCorsHeaders(origin: string | null): Headers {
    return buildSsoClientCorsHeaders(origin);
}

export function withVideoClientCors(response: Response, origin: string | null): Response {
    return withSsoClientCors(response, origin);
}

export function jsonWithVideoClientCors(
    body: unknown,
    init: ResponseInit | undefined,
    origin: string | null,
) {
    return jsonWithSsoClientCors(body, init, origin);
}

export function createVideoClientPreflightResponse(req: NextRequest) {
    return createSsoClientPreflightResponse(req);
}
