import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { AppError, errorResponse, getAuthUser } from '../../../../../../lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { id, docId } = await params;

        const { searchParams } = new URL(req.url);
        const kind = searchParams.get('kind') || 'builtin';

        if (kind !== 'custom') {
            throw new AppError('预设机器人文档请使用 /api/admin/builtin-knowledge/ 接口', 400);
        }

        const botId = id.startsWith('custom-') ? id.slice(7) : id;
        const doc = await prisma.botDocument.findFirst({
            where: { id: docId, customBotId: botId },
            select: { id: true, fileName: true, fileType: true, fileSize: true, parsedText: true, createdAt: true },
        });
        if (!doc) throw new AppError('文档不存在', 404);
        return Response.json({ success: true, data: doc });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { id, docId } = await params;
        const body = await req.json();

        const { searchParams } = new URL(req.url);
        const kind = searchParams.get('kind') || 'builtin';

        if (kind !== 'custom') {
            throw new AppError('预设机器人文档请使用 /api/admin/builtin-knowledge/ 接口', 400);
        }

        const botId = id.startsWith('custom-') ? id.slice(7) : id;
        const updateData: Record<string, string | number> = {};
        if (typeof body.parsedText === 'string') updateData.parsedText = body.parsedText;
        if (typeof body.fileName === 'string') updateData.fileName = body.fileName;

        if (Object.keys(updateData).length === 0) {
            throw new AppError('No fields to update', 400);
        }

        const doc = await prisma.botDocument.findFirst({ where: { id: docId, customBotId: botId } });
        if (!doc) throw new AppError('文档不存在', 404);
        const updated = await prisma.botDocument.update({ where: { id: docId }, data: updateData });
        return Response.json({
            success: true,
            data: { id: updated.id, fileName: updated.fileName, fileType: updated.fileType, fileSize: updated.fileSize, createdAt: updated.createdAt },
        });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { id, docId } = await params;

        const { searchParams } = new URL(req.url);
        const kind = searchParams.get('kind') || 'builtin';

        if (kind !== 'custom') {
            throw new AppError('预设机器人文档请使用 /api/admin/builtin-knowledge/ 接口', 400);
        }

        const botId = id.startsWith('custom-') ? id.slice(7) : id;
        const doc = await prisma.botDocument.findFirst({
            where: { id: docId, customBotId: botId },
        });
        if (!doc) throw new AppError('文档不存在', 404);
        await prisma.botDocument.delete({ where: { id: docId } });
        return Response.json({ success: true });
    } catch (error) {
        return errorResponse(error);
    }
}
