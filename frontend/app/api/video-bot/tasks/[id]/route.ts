import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { AppError, errorResponse, getUserId } from '../../../../lib/auth';
import {
    normalizeUpdateVideoGenerationPayload,
    normalizeVideoGeneration,
} from '../../../../lib/video-generation-history';
import {
    createVideoClientPreflightResponse,
    jsonWithVideoClientCors,
    withVideoClientCors,
} from '../../../../lib/video-site-cors';

async function loadOwnedRecord(id: string, userId: string) {
    const record = await prisma.videoGeneration.findFirst({
        where: { id, userId },
    });

    if (!record) {
        throw new AppError('Video record not found.', 404);
    }

    return record;
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const origin = req.headers.get('origin');

    try {
        const userId = await getUserId(req);
        const { id } = await context.params;
        const record = await loadOwnedRecord(id, userId);
        return jsonWithVideoClientCors(normalizeVideoGeneration(record), undefined, origin);
    } catch (error) {
        return withVideoClientCors(errorResponse(error), origin);
    }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const origin = req.headers.get('origin');

    try {
        const userId = await getUserId(req);
        const { id } = await context.params;
        const current = await loadOwnedRecord(id, userId);
        const updates = normalizeUpdateVideoGenerationPayload(await req.json());

        const status = updates.videoUrl ? 'completed' : updates.status ?? current.status;
        const completedAt = updates.completedAt !== undefined
            ? updates.completedAt
            : ((status === 'completed' || status === 'failed')
                ? current.completedAt ?? new Date()
                : current.completedAt);

        const updated = await prisma.videoGeneration.update({
            where: { id: current.id },
            data: {
                ...(updates.engine !== undefined ? { engine: updates.engine } : {}),
                ...(updates.mode !== undefined ? { mode: updates.mode } : {}),
                ...(updates.model !== undefined ? { model: updates.model } : {}),
                ...(updates.prompt !== undefined ? { prompt: updates.prompt } : {}),
                ...(updates.negativePrompt !== undefined ? { negativePrompt: updates.negativePrompt } : {}),
                ...(updates.params !== undefined ? { params: updates.params } : {}),
                ...(updates.inputs !== undefined ? { inputs: updates.inputs } : {}),
                ...(updates.engineTaskId !== undefined ? { engineTaskId: updates.engineTaskId } : {}),
                ...(updates.videoUrl !== undefined ? { videoUrl: updates.videoUrl } : {}),
                ...(updates.errorMessage !== undefined ? { errorMessage: updates.errorMessage } : {}),
                status,
                completedAt,
            },
        });

        return jsonWithVideoClientCors(normalizeVideoGeneration(updated), undefined, origin);
    } catch (error) {
        return withVideoClientCors(errorResponse(error), origin);
    }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const origin = req.headers.get('origin');

    try {
        const userId = await getUserId(req);
        const { id } = await context.params;
        const record = await loadOwnedRecord(id, userId);
        await prisma.videoGeneration.delete({ where: { id: record.id } });
        return jsonWithVideoClientCors({ success: true }, undefined, origin);
    } catch (error) {
        return withVideoClientCors(errorResponse(error), origin);
    }
}

export function OPTIONS(req: NextRequest) {
    return createVideoClientPreflightResponse(req);
}
