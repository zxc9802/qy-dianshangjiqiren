import { NextRequest } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { errorResponse, getAuthUser } from '../../../../lib/auth';

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

async function readIndex(): Promise<KnowledgeIndex> {
    const raw = await readFile(JSON_PATH, 'utf-8');
    return JSON.parse(raw);
}

async function writeIndex(index: KnowledgeIndex): Promise<void> {
    await writeFile(JSON_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { sourceId } = await params;

        const index = await readIndex();
        const source = index.sources.find((s) => s.id === sourceId);
        if (!source) {
            return Response.json({ error: '知识源不存在' }, { status: 404 });
        }

        const chunks = index.chunks.filter((c) => c.sourceId === sourceId);
        const fullText = chunks.map((c) => c.text).join('\n\n');

        return Response.json({
            success: true,
            data: {
                sourceId: source.id,
                title: source.title,
                charCount: source.charCount,
                chunkCount: source.chunkCount,
                parsedText: fullText,
            },
        });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { sourceId } = await params;

        const body = await req.json();
        const { title, parsedText } = body as { title?: string; parsedText?: string };

        const index = await readIndex();
        const sourceIdx = index.sources.findIndex((s) => s.id === sourceId);
        if (sourceIdx === -1) {
            return Response.json({ error: '知识源不存在' }, { status: 404 });
        }

        const source = index.sources[sourceIdx];

        if (title) {
            source.title = title;
        }

        if (parsedText !== undefined) {
            // Remove old chunks for this source
            index.chunks = index.chunks.filter((c) => c.sourceId !== sourceId);

            // Split text into chunks (~500 chars each with overlap)
            const CHUNK_SIZE = 500;
            const newChunks: KnowledgeChunk[] = [];
            let pos = 0;
            let chunkIdx = 1;

            while (pos < parsedText.length) {
                const end = Math.min(pos + CHUNK_SIZE, parsedText.length);
                const text = parsedText.slice(pos, end);
                newChunks.push({
                    id: `${sourceId}-${String(chunkIdx).padStart(3, '0')}`,
                    sourceId,
                    sourceTitle: source.title,
                    text,
                });
                pos = end;
                chunkIdx++;
            }

            index.chunks.push(...newChunks);

            source.charCount = parsedText.length;
            source.chunkCount = newChunks.length;
        }

        index.generatedAt = new Date().toISOString();
        await writeIndex(index);

        return Response.json({
            success: true,
            data: {
                sourceId: source.id,
                title: source.title,
                charCount: source.charCount,
                chunkCount: source.chunkCount,
            },
        });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { sourceId } = await params;

        const index = await readIndex();
        const sourceIdx = index.sources.findIndex((s) => s.id === sourceId);
        if (sourceIdx === -1) {
            return Response.json({ error: '知识源不存在' }, { status: 404 });
        }

        index.sources.splice(sourceIdx, 1);
        index.chunks = index.chunks.filter((c) => c.sourceId !== sourceId);
        index.generatedAt = new Date().toISOString();
        await writeIndex(index);

        return Response.json({ success: true });
    } catch (err) {
        return errorResponse(err);
    }
}
