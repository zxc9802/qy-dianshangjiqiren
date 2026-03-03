import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../../lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = getUserId(req);
        const { id } = await params;

        const conversation = await prisma.conversation.findFirst({
            where: { id, userId },
            include: {
                bot: { select: { id: true, name: true, icon: true, category: true, pointsPerUse: true } },
                messages: { orderBy: { createdAt: 'asc' }, include: { attachments: true } },
            },
        });
        if (!conversation) throw new AppError('对话不存在', 404);
        return Response.json({ success: true, data: conversation });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = getUserId(req);
        const { id } = await params;

        const conv = await prisma.conversation.findFirst({ where: { id, userId } });
        if (!conv) throw new AppError('对话不存在', 404);

        await prisma.conversation.delete({ where: { id: conv.id } });
        return Response.json({ success: true, message: '对话已删除' });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = getUserId(req);
        const { id } = await params;

        const conv = await prisma.conversation.findFirst({ where: { id, userId } });
        if (!conv) throw new AppError('对话不存在', 404);

        const updated = await prisma.conversation.update({
            where: { id: conv.id },
            data: { isFavorited: !conv.isFavorited },
        });
        return Response.json({ success: true, data: { isFavorited: updated.isFavorited } });
    } catch (err) {
        return errorResponse(err);
    }
}
