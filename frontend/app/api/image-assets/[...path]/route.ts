import { NextRequest } from 'next/server';
import { readBackendUrl } from '../../../lib/server-env';

async function proxyImageAsset(req: NextRequest, pathSegments: string[]) {
    const encodedPath = pathSegments.map(encodeURIComponent).join('/');
    const targetUrl = `${readBackendUrl()}/api/image-assets/${encodedPath}${req.nextUrl.search}`;

    try {
        const upstream = await fetch(targetUrl, {
            method: req.method,
            cache: 'no-store',
        });

        const headers = new Headers();
        for (const key of ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified']) {
            const value = upstream.headers.get(key);
            if (value) headers.set(key, value);
        }

        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Image asset unavailable';
        return Response.json({ success: false, message }, { status: 502 });
    }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const { path } = await params;
    return proxyImageAsset(req, path);
}

export async function HEAD(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const { path } = await params;
    return proxyImageAsset(req, path);
}
