import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../../lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = await getUserId(req);
        const { id } = await params;
        const row = await prisma.imageGeneration.findFirst({ where: { id, userId } });
        if (!row) throw new AppError('Image generation not found', 404);
        return Response.json({ success: true, data: row });
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
