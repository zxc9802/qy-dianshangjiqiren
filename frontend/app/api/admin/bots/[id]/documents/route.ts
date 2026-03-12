import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { AppError, errorResponse, getAuthUser } from '../../../../../lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { id } = await params;

        const { searchParams } = new URL(req.url);
        const kind = searchParams.get('kind') || 'builtin';

        if (kind !== 'custom') {
            // Preset bot documents are served via the bot detail endpoint (builtin knowledge JSON)
            return Response.json({ success: true, data: [] });
        }

        const botId = id.startsWith('custom-') ? id.slice(7) : id;
        const documents = await prisma.botDocument.findMany({
            where: { customBotId: botId },
            select: { id: true, fileName: true, fileType: true, fileSize: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        });
        return Response.json({ success: true, data: documents });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { id } = await params;
        const body = await req.json();

        const { searchParams } = new URL(req.url);
        const kind = searchParams.get('kind') || 'builtin';

        if (kind !== 'custom') {
            throw new AppError('预设机器人文档请使用 /api/admin/builtin-knowledge/ 接口', 400);
        }

        const botId = id.startsWith('custom-') ? id.slice(7) : id;
        const fileName = body.fileName as string;
        const fileType = body.fileType as string;
        const fileSize = body.fileSize as number;
        const parsedText = body.parsedText as string;

        if (!fileName || !parsedText) {
            throw new AppError('fileName and parsedText are required', 400);
        }

        const doc = await prisma.botDocument.create({
            data: { customBotId: botId, fileName, fileType: fileType || 'txt', fileSize: fileSize || 0, parsedText },
        });
        return Response.json({ success: true, data: { id: doc.id, fileName: doc.fileName, fileType: doc.fileType, fileSize: doc.fileSize, createdAt: doc.createdAt } });
    } catch (error) {
        return errorResponse(error);
    }
}
