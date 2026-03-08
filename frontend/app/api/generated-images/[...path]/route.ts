import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';

const LEGACY_GENERATED_IMAGES_DIR = path.join(process.cwd(), 'public', 'generated-images');

function getContentType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    switch (extension) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.webp':
            return 'image/webp';
        case '.gif':
            return 'image/gif';
        default:
            return 'image/png';
    }
}

async function serveLegacyGeneratedImage(pathSegments: string[]) {
    const relativePath = pathSegments.join('/');
    const absolutePath = path.resolve(LEGACY_GENERATED_IMAGES_DIR, relativePath);
    const normalizedRoot = path.resolve(LEGACY_GENERATED_IMAGES_DIR);

    if (!absolutePath.startsWith(normalizedRoot)) {
        return Response.json({ success: false, message: 'Invalid image path' }, { status: 400 });
    }

    try {
        const file = await fs.readFile(absolutePath);
        return new Response(file, {
            status: 200,
            headers: {
                'content-type': getContentType(absolutePath),
                'cache-control': 'private, max-age=31536000, immutable',
            },
        });
    } catch {
        return Response.json({ success: false, message: 'Legacy generated image not found' }, { status: 404 });
    }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const { path } = await params;
    return serveLegacyGeneratedImage(path);
}

export async function HEAD(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const { path } = await params;
    const response = await serveLegacyGeneratedImage(path);
    return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}
