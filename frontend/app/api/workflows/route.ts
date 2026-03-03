import { NextRequest } from 'next/server';
import { prisma } from '../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../lib/auth';
import { executeWorkflow } from '../../lib/workflow-executor';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
    try {
        const userId = getUserId(req);
        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action');

        if (action === 'presets') {
            const presets = await prisma.workflow.findMany({
                where: { isPreset: true },
                select: { id: true, name: true, description: true, usageCount: true },
            });
            return Response.json({ success: true, data: presets });
        }

        const workflows = await prisma.workflow.findMany({
            where: { OR: [{ userId }, { isPreset: true }] },
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true, name: true, description: true, triggerType: true,
                isPreset: true, isPublished: true, usageCount: true,
                createdAt: true, updatedAt: true, userId: true,
            },
        });
        return Response.json({ success: true, data: workflows });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function POST(req: NextRequest) {
    try {
        const userId = getUserId(req);
        const body = await req.json();
        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action');

        if (action === 'clone-preset') {
            const preset = await prisma.workflow.findUnique({ where: { id: body.presetId } });
            if (!preset || !preset.isPreset) throw new AppError('模板不存在', 404);
            const wf = await prisma.workflow.create({
                data: { userId, name: `${preset.name} (副本)`, description: preset.description, canvasData: preset.canvasData },
            });
            return Response.json({ success: true, data: wf }, { status: 201 });
        }

        const { name, description, canvasData } = body;
        const wf = await prisma.workflow.create({
            data: {
                userId,
                name: name || '新工作流',
                description: description || '',
                canvasData: canvasData || JSON.stringify({ nodes: [], edges: [] }),
            },
        });
        return Response.json({ success: true, data: wf }, { status: 201 });
    } catch (err) {
        return errorResponse(err);
    }
}
