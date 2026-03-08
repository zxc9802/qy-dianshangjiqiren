import { NextRequest } from 'next/server';
import { prisma } from '../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../lib/auth';

function serializeWorkflow(workflow: {
    id: string;
    clientSourceId: string | null;
    userId: string;
    name: string;
    description: string;
    canvasData: string;
    triggerType: string;
    isPreset: boolean;
    isPublished: boolean;
    usageCount: number;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        ...workflow,
        createdAt: workflow.createdAt.toISOString(),
        updatedAt: workflow.updatedAt.toISOString(),
    };
}

export async function GET(req: NextRequest) {
    try {
        const userId = await getUserId(req);
        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action');
        const scope = searchParams.get('scope');

        if (action === 'presets') {
            const presets = await prisma.workflow.findMany({
                where: { isPreset: true },
                select: {
                    id: true,
                    clientSourceId: true,
                    userId: true,
                    name: true,
                    description: true,
                    canvasData: true,
                    triggerType: true,
                    isPreset: true,
                    isPublished: true,
                    usageCount: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
            return Response.json({ success: true, data: presets.map(serializeWorkflow) });
        }

        const where = scope === 'mine'
            ? { userId, isPreset: false }
            : { OR: [{ userId }, { isPreset: true }] };

        const workflows = await prisma.workflow.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true,
                clientSourceId: true,
                userId: true,
                name: true,
                description: true,
                canvasData: true,
                triggerType: true,
                isPreset: true,
                isPublished: true,
                usageCount: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        return Response.json({ success: true, data: workflows.map(serializeWorkflow) });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function POST(req: NextRequest) {
    try {
        const userId = await getUserId(req);
        const body = await req.json();
        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action');

        if (action === 'clone-preset') {
            const preset = await prisma.workflow.findUnique({ where: { id: body.presetId } });
            if (!preset || !preset.isPreset) throw new AppError('模板不存在', 404);
            const wf = await prisma.workflow.create({
                data: {
                    userId,
                    name: `${preset.name} (副本)`,
                    description: preset.description,
                    canvasData: preset.canvasData,
                },
            });
            return Response.json({ success: true, data: serializeWorkflow(wf) }, { status: 201 });
        }

        const { name, description, canvasData, clientSourceId } = body as {
            name?: string;
            description?: string;
            canvasData?: string;
            clientSourceId?: string;
        };

        const wf = await prisma.workflow.create({
            data: {
                userId,
                clientSourceId: clientSourceId || null,
                name: name || '新工作流',
                description: description || '',
                canvasData: canvasData || JSON.stringify({ nodes: [], edges: [] }),
            },
        });
        return Response.json({ success: true, data: serializeWorkflow(wf) }, { status: 201 });
    } catch (err) {
        return errorResponse(err);
    }
}
