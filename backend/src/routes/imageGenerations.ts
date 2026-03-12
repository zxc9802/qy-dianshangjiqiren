import { Router, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer, { MulterError } from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/error';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

const MAX_PROMPT_LENGTH = 2000;
const MAX_REFERENCE_SIZE = 10 * 1024 * 1024;
const STORAGE_ROOT = path.join(process.cwd(), 'storage');
const GENERATED_DIR = path.join(STORAGE_ROOT, 'generated');
const IMAGE_API_PREFIX = '/api/image-assets/';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DEFAULT_MODEL_URL = 'https://yunwu.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_REFERENCE_SIZE },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.has(file.mimetype)) {
            cb(null, true);
            return;
        }
        cb(new AppError('Only jpg/jpeg/png/webp reference images are allowed', 400));
    },
});

const uploadSingleReference = (req: AuthRequest, res: Response) => new Promise<void>((resolve, reject) => {
    upload.single('referenceImage')(req, res, (err) => {
        if (err) reject(err);
        else resolve();
    });
});

const payloadSchema = z.object({
    prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
    negativePrompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
    aspectRatio: z.string().min(3).max(10).default('1:1'),
    stylePreset: z.string().max(100).optional(),
    background: z.string().max(100).optional(),
    lighting: z.string().max(100).optional(),
    referenceStrength: z.number().int().min(0).max(100).default(50),
    count: z.number().int().min(1).max(4).default(1),
});

function normalizeOptionalField(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
}

function buildImageApiUrl(): string {
    const apiKey = process.env.YUNWU_IMAGE_API_KEY || process.env.AI_API_KEY;
    if (!apiKey) {
        throw new AppError('YUNWU_IMAGE_API_KEY or AI_API_KEY is not configured', 500);
    }
    const baseUrl = process.env.YUNWU_IMAGE_API_URL || DEFAULT_MODEL_URL;
    const url = new URL(baseUrl);
    if (!url.searchParams.has('key')) {
        url.searchParams.set('key', apiKey);
    }
    return url.toString();
}

async function ensureStorageDirs() {
    await fs.mkdir(GENERATED_DIR, { recursive: true });
}

function toImageAssetPath(relativePath: string): string {
    return `${IMAGE_API_PREFIX}${relativePath.replaceAll('\\', '/')}`;
}

function getAssetBaseUrl(req: AuthRequest): string {
    const configured = process.env.BACKEND_PUBLIC_URL?.trim();
    if (configured) return configured.replace(/\/+$/, '');

    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = typeof forwardedProto === 'string'
        ? forwardedProto.split(',')[0].trim()
        : req.protocol || 'http';
    const host = req.get('host');
    if (!host) return '';
    return `${protocol}://${host}`;
}

function toPublicAssetUrl(req: AuthRequest, value?: string | null): string | null {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (!value.startsWith('/')) return value;
    const base = getAssetBaseUrl(req);
    return base ? `${base}${value}` : value;
}

function normalizeResultPaths(req: AuthRequest, resultImagePaths: unknown): string[] {
    if (!Array.isArray(resultImagePaths)) return [];
    return resultImagePaths
        .filter((item): item is string => typeof item === 'string')
        .map((item) => toPublicAssetUrl(req, item))
        .filter((item): item is string => Boolean(item));
}

function extractImagePart(responseData: unknown): { mimeType: string; data: string } | null {
    if (!responseData || typeof responseData !== 'object') return null;
    const record = responseData as Record<string, unknown>;
    const candidates = record.candidates as Array<Record<string, unknown>> | undefined;
    const first = candidates?.[0];
    const content = first?.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, unknown>> | undefined;
    if (!parts) return null;

    for (const part of parts) {
        const inlineData = part.inlineData as Record<string, unknown> | undefined;
        const mimeType = inlineData?.mimeType;
        const data = inlineData?.data;
        if (typeof mimeType === 'string' && typeof data === 'string' && data.length > 0) {
            return { mimeType, data };
        }
    }

    return null;
}

function buildPrompt(input: {
    prompt: string;
    negativePrompt?: string;
    stylePreset?: string;
    background?: string;
    lighting?: string;
    referenceStrength: number;
    hasReferenceImage: boolean;
    attempt: number;
    imageIndex: number;
}): string {
    const lines = [
        `Task: Create an ecommerce-ready product image (variation ${input.imageIndex + 1}).`,
        `Main prompt: ${input.prompt}`,
        input.stylePreset ? `Style preset: ${input.stylePreset}` : '',
        input.background ? `Background: ${input.background}` : '',
        input.lighting ? `Lighting: ${input.lighting}` : '',
        input.negativePrompt ? `Negative prompt: ${input.negativePrompt}` : '',
        input.hasReferenceImage ? `Reference image strength: ${input.referenceStrength}%` : '',
        'Quality: 2K output, high detail, commercial product photography quality.',
        'Output requirement: Return image only.',
        input.attempt > 0 ? 'IMPORTANT: Return inline image data only, do not return text-only response.' : '',
    ];

    return lines.filter(Boolean).join('\n');
}

async function saveGeneratedImage(inlineImage: { mimeType: string; data: string }): Promise<string> {
    const fileName = `${Date.now()}-${randomUUID()}.webp`;
    const relative = path.join('generated', fileName);
    const absolute = path.join(STORAGE_ROOT, relative);
    const inputBuffer = Buffer.from(inlineImage.data, 'base64');
    const outputBuffer = await sharp(inputBuffer).webp({ quality: 88, effort: 4 }).toBuffer();
    await fs.writeFile(absolute, outputBuffer);
    return toImageAssetPath(relative);
}

function buildGenerationInput({
    prompt,
    negativePrompt,
    stylePreset,
    background,
    lighting,
    referenceStrength,
    hasReferenceImage,
    imageIndex,
    attempt,
}: {
    prompt: string;
    negativePrompt?: string;
    stylePreset?: string;
    background?: string;
    lighting?: string;
    referenceStrength: number;
    hasReferenceImage: boolean;
    imageIndex: number;
    attempt: number;
}) {
    return buildPrompt({
        prompt,
        negativePrompt,
        stylePreset,
        background,
        lighting,
        referenceStrength,
        hasReferenceImage,
        imageIndex,
        attempt,
    });
}

async function generateOneImage(args: {
    apiUrl: string;
    aspectRatio: string;
    prompt: string;
    negativePrompt?: string;
    stylePreset?: string;
    background?: string;
    lighting?: string;
    referenceStrength: number;
    referenceImage?: { mimeType: string; base64: string };
    imageIndex: number;
}): Promise<{ imagePath?: string; error?: string }> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const parts: Array<Record<string, unknown>> = [];
        if (args.referenceImage) {
            parts.push({
                inlineData: {
                    mimeType: args.referenceImage.mimeType,
                    data: args.referenceImage.base64,
                },
            });
        }
        parts.push({
            text: buildGenerationInput({
                prompt: args.prompt,
                negativePrompt: args.negativePrompt,
                stylePreset: args.stylePreset,
                background: args.background,
                lighting: args.lighting,
                referenceStrength: args.referenceStrength,
                hasReferenceImage: Boolean(args.referenceImage),
                imageIndex: args.imageIndex,
                attempt,
            }),
        });

        try {
            const response = await fetch(args.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts }],
                    generationConfig: {
                        responseModalities: ['TEXT', 'IMAGE'],
                        imageConfig: {
                            imageSize: '2K',
                            aspectRatio: args.aspectRatio,
                        },
                    },
                }),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                if (attempt === 2) return { error: `Image API failed: ${response.status} ${errorBody}` };
                continue;
            }

            const data = await response.json();
            const imagePart = extractImagePart(data);
            if (!imagePart) {
                if (attempt === 2) return { error: 'Image API returned no inline image data' };
                continue;
            }

            const imagePath = await saveGeneratedImage(imagePart);
            return { imagePath };
        } catch (error) {
            if (attempt === 2) {
                const message = error instanceof Error ? error.message : 'Image generation request failed';
                return { error: message };
            }
        }
    }

    return { error: 'Image generation failed after retries' };
}

async function deleteAsset(publicPath?: string | null) {
    if (!publicPath || !publicPath.startsWith(IMAGE_API_PREFIX)) return;
    const relative = publicPath.slice(IMAGE_API_PREFIX.length);
    const absolute = path.join(STORAGE_ROOT, relative);
    const normalizedStorageRoot = path.resolve(STORAGE_ROOT);
    const normalizedAbsolute = path.resolve(absolute);
    if (!normalizedAbsolute.startsWith(normalizedStorageRoot)) return;
    try {
        await fs.unlink(normalizedAbsolute);
    } catch {
        // ignore unlink errors
    }
}

router.post('/generate', async (req: AuthRequest, res: Response) => {
    if (!req.userId) throw new AppError('Unauthorized', 401);

    try {
        await uploadSingleReference(req, res);
    } catch (error) {
        if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
            throw new AppError('Reference image must be <= 10MB', 400);
        }
        if (error instanceof AppError) throw error;
        throw new AppError('Invalid upload payload', 400);
    }

    const parsed = payloadSchema.parse({
        prompt: req.body.prompt,
        negativePrompt: normalizeOptionalField(req.body.negativePrompt),
        aspectRatio: normalizeOptionalField(req.body.aspectRatio) || '1:1',
        stylePreset: normalizeOptionalField(req.body.stylePreset),
        background: normalizeOptionalField(req.body.background),
        lighting: normalizeOptionalField(req.body.lighting),
        referenceStrength: normalizeNumber(req.body.referenceStrength, 50, 0, 100),
        count: normalizeNumber(req.body.count, 1, 1, 4),
    });

    await ensureStorageDirs();
    const apiUrl = buildImageApiUrl();

    let referenceImageInput: { mimeType: string; base64: string } | undefined;

    if (req.file) {
        referenceImageInput = {
            mimeType: req.file.mimetype,
            base64: req.file.buffer.toString('base64'),
        };
    }

    const imageIndexes = Array.from({ length: parsed.count }, (_, idx) => idx);
    const imageResults: Array<{ imagePath?: string; error?: string }> = [];

    for (let i = 0; i < imageIndexes.length; i += 2) {
        const chunk = imageIndexes.slice(i, i + 2);
        const chunkResults = await Promise.all(chunk.map((imageIndex) => generateOneImage({
            apiUrl,
            aspectRatio: parsed.aspectRatio,
            prompt: parsed.prompt,
            negativePrompt: parsed.negativePrompt,
            stylePreset: parsed.stylePreset,
            background: parsed.background,
            lighting: parsed.lighting,
            referenceStrength: parsed.referenceStrength,
            referenceImage: referenceImageInput,
            imageIndex,
        })));
        imageResults.push(...chunkResults);
    }

    const resultImagePaths = imageResults
        .map((item) => item.imagePath)
        .filter((item): item is string => Boolean(item));
    const errors = imageResults
        .map((item) => item.error)
        .filter((item): item is string => Boolean(item));

    const status = resultImagePaths.length === 0
        ? 'failed'
        : errors.length > 0
            ? 'partial'
            : 'success';

    const saved = await prisma.imageGeneration.create({
        data: {
            userId: req.userId,
            prompt: parsed.prompt,
            negativePrompt: parsed.negativePrompt,
            aspectRatio: parsed.aspectRatio,
            imageSize: '2K',
            stylePreset: parsed.stylePreset,
            background: parsed.background,
            lighting: parsed.lighting,
            referenceStrength: parsed.referenceStrength,
            count: parsed.count,
            referenceImagePath: null,
            resultImagePaths,
            status,
            errorMessage: errors.length ? errors.join('\n') : null,
        },
    });

    res.json({
        success: true,
        data: {
            ...saved,
            referenceImagePath: null,
            resultImagePaths: normalizeResultPaths(req, resultImagePaths),
        },
    });
});

router.get('/', async (req: AuthRequest, res: Response) => {
    if (!req.userId) throw new AppError('Unauthorized', 401);
    const cursorRaw = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 20;

    let cursorWhere: Record<string, unknown> = {};
    if (cursorRaw) {
        const cursorItem = await prisma.imageGeneration.findFirst({
            where: { id: cursorRaw, userId: req.userId },
            select: { id: true, createdAt: true },
        });
        if (cursorItem) {
            cursorWhere = {
                OR: [
                    { createdAt: { lt: cursorItem.createdAt } },
                    { createdAt: cursorItem.createdAt, id: { lt: cursorItem.id } },
                ],
            };
        }
    }

    const rows = await prisma.imageGeneration.findMany({
        where: {
            userId: req.userId,
            ...cursorWhere,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    res.json({
        success: true,
        data: {
            items: items.map((item) => ({
                ...item,
                referenceImagePath: toPublicAssetUrl(req, item.referenceImagePath),
                resultImagePaths: normalizeResultPaths(req, item.resultImagePaths),
            })),
            nextCursor,
        },
    });
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
    if (!req.userId) throw new AppError('Unauthorized', 401);
    const id = String(req.params.id);
    const row = await prisma.imageGeneration.findFirst({
        where: { id, userId: req.userId },
    });
    if (!row) throw new AppError('Image generation record not found', 404);

    res.json({
        success: true,
        data: {
            ...row,
            referenceImagePath: toPublicAssetUrl(req, row.referenceImagePath),
            resultImagePaths: normalizeResultPaths(req, row.resultImagePaths),
        },
    });
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
    if (!req.userId) throw new AppError('Unauthorized', 401);
    const id = String(req.params.id);
    const row = await prisma.imageGeneration.findFirst({
        where: { id, userId: req.userId },
    });
    if (!row) throw new AppError('Image generation record not found', 404);

    if (row.referenceImagePath) {
        await deleteAsset(row.referenceImagePath);
    }
    if (Array.isArray(row.resultImagePaths)) {
        for (const pathValue of row.resultImagePaths) {
            if (typeof pathValue === 'string') {
                await deleteAsset(pathValue);
            }
        }
    }

    await prisma.imageGeneration.delete({ where: { id: row.id } });
    res.json({ success: true });
});

export default router;
