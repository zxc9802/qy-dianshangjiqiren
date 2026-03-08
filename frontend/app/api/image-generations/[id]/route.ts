import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../../lib/auth';
import { normalizeGeneratedImagePaths } from '../../../lib/generated-image-storage';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = await getUserId(req);
        const { id } = await params;
        const row = await prisma.imageGeneration.findFirst({ where: { id, userId } });
        if (!row) throw new AppError('Image generation not found', 404);
        const normalized = await normalizeGeneratedImagePaths(row.resultImagePaths);
        if (normalized.mutated) {
            await prisma.imageGeneration.update({
                where: { id: row.id },
                data: { resultImagePaths: normalized.paths },
            });
        }
        return Response.json({
            success: true,
            data: {
                ...row,
                resultImagePaths: normalized.paths,
            },
        });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = await getUserId(req);
        const { id } = await params;
        const row = await prisma.imageGeneration.findFirst({ where: { id, userId } });
        if (!row) throw new AppError('Image generation not found', 404);
        await prisma.imageGeneration.delete({ where: { id: row.id } });
        return Response.json({ success: true });
    } catch (err) {
        return errorResponse(err);
    }
}
