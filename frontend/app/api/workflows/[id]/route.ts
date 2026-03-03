import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../../lib/auth';
import { executeWorkflow } from '../../../lib/workflow-executor';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = getUserId(req);
        const { id } = await params;
        const { searchParams } = new URL(req.url);
        const sub = searchParams.get('sub');

        // GET /api/workflows/[id]?sub=executions
        if (sub === 'executions') {
            const executions = await prisma.workflowExecution.findMany({
                where: { workflowId: id, userId },
                orderBy: { startedAt: 'desc' },
                take: 20,
            });
            return Response.json({ success: true, data: executions });
        }

        // GET /api/workflows/[id]?sub=execution&eid=xxx
        if (sub === 'execution') {
            const eid = searchParams.get('eid');
            if (!eid) throw new AppError('缺少 eid 参数');
            const exec = await prisma.workflowExecution.findUnique({ where: { id: eid } });
            if (!exec) throw new AppError('执行记录不存在', 404);
            if (exec.userId !== userId) throw new AppError('无权访问', 403);
            return Response.json({ success: true, data: exec });
        }

        // Default: workflow detail
        const wf = await prisma.workflow.findUnique({ where: { id } });
        if (!wf) throw new AppError('工作流不存在', 404);
        if (wf.userId !== userId && !wf.isPreset) throw new AppError('无权访问', 403);
        return Response.json({ success: true, data: wf });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = getUserId(req);
        const { id } = await params;
        const existing = await prisma.workflow.findUnique({ where: { id } });
        if (!existing) throw new AppError('工作流不存在', 404);
        if (existing.userId !== userId) throw new AppError('无权修改', 403);

        const { name, description, canvasData, triggerType, cronExpr } = await req.json();
        const wf = await prisma.workflow.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
                ...(canvasData !== undefined && { canvasData }),
                ...(triggerType !== undefined && { triggerType }),
                ...(cronExpr !== undefined && { cronExpr }),
            },
        });
        return Response.json({ success: true, data: wf });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = getUserId(req);
        const { id } = await params;
        const existing = await prisma.workflow.findUnique({ where: { id } });
        if (!existing) throw new AppError('工作流不存在', 404);
        if (existing.userId !== userId) throw new AppError('无权删除', 403);
        await prisma.workflow.delete({ where: { id } });
        return Response.json({ success: true });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = getUserId(req);
        const { id } = await params;
        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action');

        const wf = await prisma.workflow.findUnique({ where: { id } });
        if (!wf) throw new AppError('工作流不存在', 404);

        if (action === 'run') {
            const body = await req.json();
            const execution = await prisma.workflowExecution.create({
                data: { workflowId: wf.id, userId, input: body.input ? JSON.stringify(body.input) : null },
            });
            executeWorkflow(wf, execution.id, userId).catch(console.error);
            await prisma.workflow.update({ where: { id: wf.id }, data: { usageCount: { increment: 1 } } });
            return Response.json({ success: true, data: { executionId: execution.id } });
        }

        if (action === 'schedule') {
            if (wf.userId !== userId) throw new AppError('无权修改', 403);
            const { cronExpr } = await req.json();
            const updated = await prisma.workflow.update({
                where: { id },
                data: { triggerType: cronExpr ? 'cron' : 'manual', cronExpr },
            });
            return Response.json({ success: true, data: updated });
        }

        if (action === 'webhook') {
            if (wf.userId !== userId) throw new AppError('无权修改', 403);
            const webhookKey = randomBytes(16).toString('hex');
            const updated = await prisma.workflow.update({
                where: { id },
                data: { triggerType: 'webhook', webhookKey },
            });
            return Response.json({ success: true, data: { webhookKey: updated.webhookKey } });
        }

        return Response.json({ error: '无效的操作' }, { status: 400 });
    } catch (err) {
        return errorResponse(err);
    }
}
