import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../../lib/auth';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = getUserId(req);
        const { id } = await params;

        const row = await prisma.imagePromptTag.findFirst({ where: { id, userId } });
        if (!row) throw new AppError('Custom tag not found', 404);

        await prisma.imagePromptTag.delete({ where: { id: row.id } });
        return Response.json({ success: true, message: 'Deleted' });
    } catch (err) {
        return errorResponse(err);
    }
}
