import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/error';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { executeWorkflow } from '../services/workflow-executor';
import { randomBytes } from 'crypto';

const router = Router();

// All routes require auth
router.use(authMiddleware);

// List user workflows + presets
router.get('/', async (req: AuthRequest, res: Response) => {
    const workflows = await prisma.workflow.findMany({
        where: { OR: [{ userId: req.userId }, { isPreset: true }] },
        orderBy: { updatedAt: 'desc' },
        select: {
            id: true, name: true, description: true, triggerType: true,
            isPreset: true, isPublished: true, usageCount: true,
            createdAt: true, updatedAt: true, userId: true,
        },
    });
    res.json({ success: true, data: workflows });
});

// Get workflow detail (with canvas data)
router.get('/:id', async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id);
    const wf = await prisma.workflow.findUnique({ where: { id } });
    if (!wf) throw new AppError('工作流不存在', 404);
    if (wf.userId !== req.userId && !wf.isPreset) throw new AppError('无权访问', 403);
    res.json({ success: true, data: wf });
});

// Create workflow
router.post('/', async (req: AuthRequest, res: Response) => {
    const { name, description, canvasData } = req.body;
    const wf = await prisma.workflow.create({
        data: {
            userId: req.userId!,
            name: name || '新工作流',
            description: description || '',
            canvasData: canvasData || JSON.stringify({ nodes: [], edges: [] }),
        },
    });
    res.status(201).json({ success: true, data: wf });
});

// Update workflow
router.put('/:id', async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id);
    const existing = await prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new AppError('工作流不存在', 404);
    if (existing.userId !== req.userId) throw new AppError('无权修改', 403);

    const { name, description, canvasData, triggerType, cronExpr } = req.body;
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
    res.json({ success: true, data: wf });
});

// Delete workflow
router.delete('/:id', async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id);
    const existing = await prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new AppError('工作流不存在', 404);
    if (existing.userId !== req.userId) throw new AppError('无权删除', 403);
    await prisma.workflow.delete({ where: { id } });
    res.json({ success: true });
});

// Run workflow
router.post('/:id/run', async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id);
    const wf = await prisma.workflow.findUnique({ where: { id } });
    if (!wf) throw new AppError('工作流不存在', 404);

    const execution = await prisma.workflowExecution.create({
        data: {
            workflowId: wf.id,
            userId: req.userId!,
            input: req.body.input ? JSON.stringify(req.body.input) : null,
        },
    });

    // Run asynchronously
    executeWorkflow(wf, execution.id, req.userId!).catch(console.error);

    // Increment usage count
    await prisma.workflow.update({
        where: { id: wf.id },
        data: { usageCount: { increment: 1 } },
    });

    res.json({ success: true, data: { executionId: execution.id } });
});

// Get execution history
router.get('/:id/executions', async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id);
    const executions = await prisma.workflowExecution.findMany({
        where: { workflowId: id, userId: req.userId! },
        orderBy: { startedAt: 'desc' },
        take: 20,
    });
    res.json({ success: true, data: executions });
});

// Get execution detail
router.get('/executions/:eid', async (req: AuthRequest, res: Response) => {
    const eid = String(req.params.eid);
    const exec = await prisma.workflowExecution.findUnique({ where: { id: eid } });
    if (!exec) throw new AppError('执行记录不存在', 404);
    if (exec.userId !== req.userId) throw new AppError('无权访问', 403);
    res.json({ success: true, data: exec });
});

// Set schedule
router.post('/:id/schedule', async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id);
    const { cronExpr } = req.body;
    const existing = await prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new AppError('工作流不存在', 404);
    if (existing.userId !== req.userId) throw new AppError('无权修改', 403);

    const wf = await prisma.workflow.update({
        where: { id },
        data: { triggerType: cronExpr ? 'cron' : 'manual', cronExpr },
    });
    res.json({ success: true, data: wf });
});

// Generate webhook key
router.post('/:id/webhook', async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id);
    const existing = await prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new AppError('工作流不存在', 404);
    if (existing.userId !== req.userId) throw new AppError('无权修改', 403);

    const webhookKey = randomBytes(16).toString('hex');
    const wf = await prisma.workflow.update({
        where: { id },
        data: { triggerType: 'webhook', webhookKey },
    });
    res.json({ success: true, data: { webhookKey: wf.webhookKey } });
});

// Clone from preset
router.post('/presets/:id/clone', async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id);
    const preset = await prisma.workflow.findUnique({ where: { id } });
    if (!preset || !preset.isPreset) throw new AppError('模板不存在', 404);

    const wf = await prisma.workflow.create({
        data: {
            userId: req.userId!,
            name: `${preset.name} (副本)`,
            description: preset.description,
            canvasData: preset.canvasData,
        },
    });
    res.status(201).json({ success: true, data: wf });
});

// Get presets
router.get('/presets/list', async (_req: Request, res: Response) => {
    const presets = await prisma.workflow.findMany({
        where: { isPreset: true },
        select: { id: true, name: true, description: true, usageCount: true },
    });
    res.json({ success: true, data: presets });
});

export default router;
