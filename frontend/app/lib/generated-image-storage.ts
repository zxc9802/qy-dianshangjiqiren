import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const GENERATED_IMAGES_DIR = path.join(process.cwd(), 'public', 'generated-images');

const MIME_EXTENSION_MAP: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

function getExtensionForMimeType(mimeType: string): string {
    return MIME_EXTENSION_MAP[mimeType.toLowerCase()] || 'png';
}

export function isImageDataUri(value: string): boolean {
    return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);
}

export async function persistBase64Image(base64: string, mimeType: string): Promise<string> {
    const extension = getExtensionForMimeType(mimeType);
    const fileName = `${Date.now()}-${randomUUID()}.${extension}`;
    const filePath = path.join(GENERATED_IMAGES_DIR, fileName);

    await mkdir(GENERATED_IMAGES_DIR, { recursive: true });
    await writeFile(filePath, Buffer.from(base64, 'base64'));

    return `/generated-images/${fileName}`;
}

export async function persistImageDataUri(dataUri: string): Promise<string> {
    const match = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
    if (!match) {
        throw new Error('Invalid image data URI');
    }

    return persistBase64Image(match[2], match[1]);
}

export async function normalizeGeneratedImagePaths(input: unknown): Promise<{ paths: string[]; mutated: boolean }> {
    if (!Array.isArray(input)) {
        return { paths: [], mutated: false };
    }

    let mutated = false;
    const paths = await Promise.all(input.map(async (item) => {
        if (typeof item !== 'string' || !item) {
            mutated = true;
            return '';
        }

        if (isImageDataUri(item)) {
            mutated = true;
            return persistImageDataUri(item);
        }

        return item;
    }));

    return { paths: paths.filter(Boolean), mutated };
}
