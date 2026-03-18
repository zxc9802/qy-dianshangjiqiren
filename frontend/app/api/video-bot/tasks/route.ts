import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { errorResponse, getUserId } from '../../../lib/auth';
import {
    normalizeCreateVideoGenerationPayload,
    normalizeVideoGeneration,
} from '../../../lib/video-generation-history';
import {
    createVideoClientPreflightResponse,
    jsonWithVideoClientCors,
    withVideoClientCors,
} from '../../../lib/video-site-cors';

function readLimit(req: NextRequest): number {
    const raw = Number(req.nextUrl.searchParams.get('limit') || '100');
    if (!Number.isFinite(raw)) {
        return 100;
    }
    return Math.max(1, Math.min(200, Math.floor(raw)));
}

export async function GET(req: NextRequest) {
    const origin = req.headers.get('origin');

    try {
        const userId = await getUserId(req);

        // 5-day retention: only return recent records
        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

        const tasks = await prisma.videoGeneration.findMany({
            where: {
                userId,
                createdAt: { gte: fiveDaysAgo },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: readLimit(req),
        });

        // Lazy cleanup: delete expired records in background (fire-and-forget)
        prisma.videoGeneration.deleteMany({
            where: {
                userId,
                createdAt: { lt: fiveDaysAgo },
            },
        }).catch(() => { /* ignore cleanup errors */ });

        return jsonWithVideoClientCors(tasks.map(normalizeVideoGeneration), undefined, origin);
    } catch (error) {
        return withVideoClientCors(errorResponse(error), origin);
    }
}

export async function POST(req: NextRequest) {
    const origin = req.headers.get('origin');

    try {
        const userId = await getUserId(req);
        const payload = normalizeCreateVideoGenerationPayload(await req.json());
        const status = payload.videoUrl ? 'completed' : payload.status ?? 'queued';
        const completedAt = payload.completedAt ?? ((status === 'completed' || status === 'failed') ? new Date() : null);

        const created = await prisma.videoGeneration.create({
            data: {
                userId,
                engine: payload.engine!,
                mode: payload.mode!,
                model: payload.model ?? null,
                prompt: payload.prompt ?? null,
                negativePrompt: payload.negativePrompt ?? null,
                params: payload.params,
                inputs: payload.inputs,
                engineTaskId: payload.engineTaskId ?? null,
                videoUrl: payload.videoUrl ?? null,
                status,
                errorMessage: payload.errorMessage ?? null,
                completedAt,
            },
        });

        return jsonWithVideoClientCors(normalizeVideoGeneration(created), { status: 201 }, origin);
    } catch (error) {
        return withVideoClientCors(errorResponse(error), origin);
    }
}

export function OPTIONS(req: NextRequest) {
    return createVideoClientPreflightResponse(req);
}
