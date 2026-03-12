import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { AppError, errorResponse, getAuthUser } from '../../../../../lib/auth';

async function resolveBotId(idOrRouteId: string, kind: string): Promise<string> {
    if (kind === 'custom') {
        return idOrRouteId.startsWith('custom-') ? idOrRouteId.slice(7) : idOrRouteId;
    }
    const bot = await prisma.bot.findUnique({ where: { id: idOrRouteId } });
    if (bot) return bot.id;
    const bySlug = await prisma.bot.findUnique({ where: { slug: idOrRouteId } });
    if (bySlug) return bySlug.id;
    const sortOrder = Number(idOrRouteId);
    if (!isNaN(sortOrder)) {
        const bySortOrder = await prisma.bot.findFirst({ where: { sortOrder } });
        if (bySortOrder) return bySortOrder.id;
    }
    throw new AppError('智能体不存在', 404);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { id } = await params;

        const { searchParams } = new URL(req.url);
        const kind = searchParams.get('kind') || 'builtin';
        const botId = await resolveBotId(id, kind);

        if (kind === 'custom') {
            const documents = await prisma.botDocument.findMany({
                where: { customBotId: botId },
                select: { id: true, fileName: true, fileType: true, fileSize: true, createdAt: true },
                orderBy: { createdAt: 'desc' },
            });
            return Response.json({ success: true, data: documents });
        }

        const documents = await prisma.presetBotDocument.findMany({
            where: { botId },
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
        const botId = await resolveBotId(id, kind);

        const fileName = body.fileName as string;
        const fileType = body.fileType as string;
        const fileSize = body.fileSize as number;
        const parsedText = body.parsedText as string;

        if (!fileName || !parsedText) {
            throw new AppError('fileName and parsedText are required', 400);
        }

        if (kind === 'custom') {
            const doc = await prisma.botDocument.create({
                data: { customBotId: botId, fileName, fileType: fileType || 'txt', fileSize: fileSize || 0, parsedText },
            });
            return Response.json({ success: true, data: { id: doc.id, fileName: doc.fileName, fileType: doc.fileType, fileSize: doc.fileSize, createdAt: doc.createdAt } });
        }

        const doc = await prisma.presetBotDocument.create({
            data: { botId, fileName, fileType: fileType || 'txt', fileSize: fileSize || 0, parsedText },
        });

        return Response.json({ success: true, data: { id: doc.id, fileName: doc.fileName, fileType: doc.fileType, fileSize: doc.fileSize, createdAt: doc.createdAt } });
    } catch (error) {
        return errorResponse(error);
    }
}
