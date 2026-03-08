import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../lib/auth';
import { normalizeGeneratedImagePaths, persistBase64Image } from '../../lib/generated-image-storage';
import { readServerEnv } from '../../lib/server-env';

const MAX_PROMPT_LENGTH = 2000;
const DEFAULT_MODEL_URL = 'https://yunwu.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent';
const IMAGE_API_TIMEOUT_MS = 45000;
const MAX_IMAGE_ATTEMPTS = 2;

const payloadSchema = z.object({
    prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
    negativePrompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
    aspectRatio: z.string().min(3).max(10).default('1:1'),
    stylePreset: z.string().max(100).optional(),
    background: z.string().max(100).optional(),
    lighting: z.string().max(100).optional(),
    referenceStrength: z.number().int().min(0).max(100).default(50),
    count: z.number().int().min(1).max(4).default(1),
    referenceImage: z.string().optional(), // base64
    referenceImageMime: z.string().optional(),
});

function buildImageApiUrl(): string {
    const apiKey = readServerEnv('YUNWU_IMAGE_API_KEY') || readServerEnv('AI_API_KEY');
    if (!apiKey) throw new AppError('Image API key not configured', 500);
    const baseUrl = readServerEnv('YUNWU_IMAGE_API_URL') || DEFAULT_MODEL_URL;
    const url = new URL(baseUrl);
    if (!url.searchParams.has('key')) url.searchParams.set('key', apiKey);
    return url.toString();
}

function extractImagePart(responseData: unknown): { mimeType: string; data: string } | null {
    if (!responseData || typeof responseData !== 'object') return null;
    const record = responseData as Record<string, unknown>;
    const candidates = record.candidates as Array<Record<string, unknown>> | undefined;
    const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
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
    prompt: string; negativePrompt?: string; stylePreset?: string;
    background?: string; lighting?: string; referenceStrength: number;
    hasReference: boolean; attempt: number; imageIndex: number;
}): string {
    return [
        `Task: Create an ecommerce-ready product image (variation ${input.imageIndex + 1}).`,
        `Main prompt: ${input.prompt}`,
        input.stylePreset ? `Style preset: ${input.stylePreset}` : '',
        input.background ? `Background: ${input.background}` : '',
        input.lighting ? `Lighting: ${input.lighting}` : '',
        input.negativePrompt ? `Negative prompt: ${input.negativePrompt}` : '',
        input.hasReference ? `Reference image strength: ${input.referenceStrength}%` : '',
        'Quality: 2K output, high detail, commercial product photography quality.',
        'Output requirement: Return image only.',
        input.attempt > 0 ? 'IMPORTANT: Return inline image data only.' : '',
    ].filter(Boolean).join('\n');
}

async function generateOneImage(args: {
    apiUrl: string; aspectRatio: string; prompt: string; negativePrompt?: string;
    stylePreset?: string; background?: string; lighting?: string;
    referenceStrength: number; referenceImage?: { mimeType: string; base64: string };
    imageIndex: number;
}): Promise<{ base64?: string; mimeType?: string; error?: string }> {
    for (let attempt = 0; attempt < MAX_IMAGE_ATTEMPTS; attempt++) {
        const parts: Array<Record<string, unknown>> = [];
        if (args.referenceImage) {
            parts.push({ inlineData: { mimeType: args.referenceImage.mimeType, data: args.referenceImage.base64 } });
        }
        parts.push({
            text: buildPrompt({
                prompt: args.prompt, negativePrompt: args.negativePrompt,
                stylePreset: args.stylePreset, background: args.background,
                lighting: args.lighting, referenceStrength: args.referenceStrength,
                hasReference: Boolean(args.referenceImage), imageIndex: args.imageIndex, attempt,
            }),
        });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), IMAGE_API_TIMEOUT_MS);
        try {
            const response = await fetch(args.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    contents: [{ role: 'user', parts }],
                    generationConfig: {
                        responseModalities: ['TEXT', 'IMAGE'],
                        imageConfig: { imageSize: '2K', aspectRatio: args.aspectRatio },
                    },
                }),
            });

            if (!response.ok) {
                if (attempt === MAX_IMAGE_ATTEMPTS - 1) return { error: `Image API failed: ${response.status}` };
                continue;
            }

            const data = await response.json();
            const imagePart = extractImagePart(data);
            if (!imagePart) {
                if (attempt === MAX_IMAGE_ATTEMPTS - 1) return { error: 'No image data returned' };
                continue;
            }

            // Return base64 directly (stored in DB instead of filesystem)
            return { base64: imagePart.data, mimeType: imagePart.mimeType };
        } catch (error) {
            const message = error instanceof Error && error.name === 'AbortError'
                ? `Image generation timed out after ${Math.round(IMAGE_API_TIMEOUT_MS / 1000)}s`
                : error instanceof Error ? error.message : 'Generation failed';
            if (attempt === MAX_IMAGE_ATTEMPTS - 1) return { error: message };
        } finally {
            clearTimeout(timeout);
        }
    }
    return { error: 'Generation failed after retries' };
}

export async function GET(req: NextRequest) {
    try {
        const userId = await getUserId(req);
        const { searchParams } = new URL(req.url);
        const cursor = searchParams.get('cursor');
        const limitRaw = Number(searchParams.get('limit') || '20');
        const limit = Math.max(1, Math.min(50, Math.floor(limitRaw)));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let cursorWhere: any = {};
        if (cursor) {
            const cursorItem = await prisma.imageGeneration.findFirst({
                where: { id: cursor, userId },
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
            where: { userId, ...cursorWhere },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
        });

        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1]?.id : null;

        const normalizedItems = await Promise.all(items.map(async (item) => {
            const normalized = await normalizeGeneratedImagePaths(item.resultImagePaths);
            if (normalized.mutated) {
                await prisma.imageGeneration.update({
                    where: { id: item.id },
                    data: { resultImagePaths: normalized.paths },
                });
            }

            return {
                ...item,
                resultImagePaths: normalized.paths,
            };
        }));

        return Response.json({ success: true, data: { items: normalizedItems, nextCursor } });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function POST(req: NextRequest) {
    try {
        const userId = await getUserId(req);
        const body = await req.json();
        const parsed = payloadSchema.parse(body);
        const apiUrl = buildImageApiUrl();

        let referenceImageInput: { mimeType: string; base64: string } | undefined;
        if (parsed.referenceImage && parsed.referenceImageMime) {
            referenceImageInput = { mimeType: parsed.referenceImageMime, base64: parsed.referenceImage };
        }

        const results: Array<{ base64?: string; mimeType?: string; error?: string }> = [];
        const indexes = Array.from({ length: parsed.count }, (_, i) => i);

        for (let i = 0; i < indexes.length; i += 2) {
            const chunk = indexes.slice(i, i + 2);
            const chunkResults = await Promise.all(chunk.map(imageIndex => generateOneImage({
                apiUrl, aspectRatio: parsed.aspectRatio, prompt: parsed.prompt,
                negativePrompt: parsed.negativePrompt, stylePreset: parsed.stylePreset,
                background: parsed.background, lighting: parsed.lighting,
                referenceStrength: parsed.referenceStrength,
                referenceImage: referenceImageInput, imageIndex,
            })));
            results.push(...chunkResults);
        }

        const resultImagePaths = await Promise.all(
            results
                .filter((result): result is { base64: string; mimeType: string; error?: string } => Boolean(result.base64 && result.mimeType))
                .map((result) => persistBase64Image(result.base64, result.mimeType)),
        );
        const errors = results.filter(r => r.error).map(r => r.error!);

        const status = resultImagePaths.length === 0 ? 'failed' : errors.length > 0 ? 'partial' : 'success';

        const saved = await prisma.imageGeneration.create({
            data: {
                userId,
                prompt: parsed.prompt,
                negativePrompt: parsed.negativePrompt,
                aspectRatio: parsed.aspectRatio,
                imageSize: '2K',
                stylePreset: parsed.stylePreset,
                background: parsed.background,
                lighting: parsed.lighting,
                referenceStrength: parsed.referenceStrength,
                count: parsed.count,
                referenceImagePath: parsed.referenceImage && parsed.referenceImageMime
                    ? await persistBase64Image(parsed.referenceImage, parsed.referenceImageMime)
                    : null,
                resultImagePaths,
                status,
                errorMessage: errors.length ? errors.join('\n') : null,
            },
        });

        return Response.json({ success: true, data: saved });
    } catch (err) {
        return errorResponse(err);
    }
}
