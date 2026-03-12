import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { AppError, errorResponse, getAuthUser } from '../../../../../lib/auth';
import { QIYA_ENTERPRISE_MANAGEMENT_BOT_ID } from '../../../../../lib/builtin-bots';

const JSON_PATH = join(process.cwd(), 'app/lib/builtin-knowledge/qiya-enterprise-management.json');

interface KnowledgeChunk {
    id: string;
    sourceId: string;
    sourceTitle: string;
    text: string;
}

interface KnowledgeSource {
    id: string;
    title: string;
    charCount: number;
    chunkCount: number;
}

interface KnowledgeIndex {
    version: number;
    generatedAt: string;
    botId: string;
    sources: KnowledgeSource[];
    chunks: KnowledgeChunk[];
}

async function resolvePresetBot(idOrRouteId: string) {
    let bot = await prisma.bot.findUnique({ where: { id: idOrRouteId } });
    if (bot) return bot;
    bot = await prisma.bot.findUnique({ where: { slug: idOrRouteId } });
    if (bot) return bot;
    const sortOrder = Number(idOrRouteId);
    if (!isNaN(sortOrder)) {
        bot = await prisma.bot.findFirst({ where: { sortOrder } });
    }
    return bot;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { id } = await params;

        const { searchParams } = new URL(req.url);
        const kind = searchParams.get('kind') || 'builtin';

        if (kind !== 'custom') {
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

        const fileName = body.fileName as string;
        const fileType = body.fileType as string;
        const fileSize = body.fileSize as number;
        const parsedText = body.parsedText as string;

        if (!fileName || !parsedText) {
            throw new AppError('fileName and parsedText are required', 400);
        }

        if (kind === 'custom') {
            const botId = id.startsWith('custom-') ? id.slice(7) : id;
            const doc = await prisma.botDocument.create({
                data: { customBotId: botId, fileName, fileType: fileType || 'txt', fileSize: fileSize || 0, parsedText },
            });
            return Response.json({ success: true, data: { id: doc.id, fileName: doc.fileName, fileType: doc.fileType, fileSize: doc.fileSize, createdAt: doc.createdAt } });
        }

        // Preset (builtin) bot — add to JSON knowledge file
        const bot = await resolvePresetBot(id);
        if (!bot) throw new AppError('智能体不存在', 404);

        const isQiyaBot = String(bot.sortOrder) === QIYA_ENTERPRISE_MANAGEMENT_BOT_ID;
        if (!isQiyaBot) {
            throw new AppError('此预设机器人暂不支持上传文档', 400);
        }

        const raw = await readFile(JSON_PATH, 'utf-8');
        const index: KnowledgeIndex = JSON.parse(raw);

        const newSourceId = `uploaded-${Date.now()}`;
        const CHUNK_SIZE = 500;
        const newChunks: KnowledgeChunk[] = [];
        let pos = 0;
        let chunkIdx = 1;

        while (pos < parsedText.length) {
            const end = Math.min(pos + CHUNK_SIZE, parsedText.length);
            newChunks.push({
                id: `${newSourceId}-${String(chunkIdx).padStart(3, '0')}`,
                sourceId: newSourceId,
                sourceTitle: fileName,
                text: parsedText.slice(pos, end),
            });
            pos = end;
            chunkIdx++;
        }

        index.sources.push({
            id: newSourceId,
            title: fileName,
            charCount: parsedText.length,
            chunkCount: newChunks.length,
        });
        index.chunks.push(...newChunks);
        index.generatedAt = new Date().toISOString();

        await writeFile(JSON_PATH, JSON.stringify(index, null, 2), 'utf-8');

        return Response.json({
            success: true,
            data: {
                id: `builtin-${newSourceId}`,
                fileName,
                fileType: fileType || 'txt',
                fileSize: fileSize || parsedText.length,
                createdAt: new Date().toISOString(),
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}
