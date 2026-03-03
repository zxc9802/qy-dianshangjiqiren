import { Router, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '../utils/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/error';

const router = Router();
router.use(authMiddleware);

const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'bot-avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const avatarStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
});

const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, allowed.includes(ext));
    },
});

// GET /api/custom-bots — list user's custom bots
router.get('/', async (req: AuthRequest, res: Response) => {
    const bots = await prisma.customBot.findMany({
        where: { userId: req.userId!, isActive: true },
        include: { documents: { select: { id: true, fileName: true, fileType: true, fileSize: true, createdAt: true } } },
        orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: bots });
});

// POST /api/custom-bots — create a new custom bot
router.post('/', async (req: AuthRequest, res: Response) => {
    const { name, description, icon, systemPrompt, pointsPerUse } = req.body;
    if (!name?.trim()) throw new AppError('请输入智能体名称', 400);
    if (!systemPrompt?.trim()) throw new AppError('请输入系统提示词', 400);

    const count = await prisma.customBot.count({ where: { userId: req.userId!, isActive: true } });
    if (count >= 20) throw new AppError('最多创建 20 个自定义智能体', 400);

    const bot = await prisma.customBot.create({
        data: {
            userId: req.userId!,
            name: name.trim(),
            description: (description || '').trim(),
            icon: icon || 'bot',
            systemPrompt: systemPrompt.trim(),
            pointsPerUse: Math.max(1, Math.min(50, Number(pointsPerUse) || 3)),
        },
    });

    res.json({ success: true, data: bot });
});

// GET /api/custom-bots/:id — get detail with documents
router.get('/:id', async (req: AuthRequest, res: Response) => {
    const bot = await prisma.customBot.findFirst({
        where: { id: req.params.id, userId: req.userId!, isActive: true },
        include: { documents: { orderBy: { createdAt: 'desc' } } },
    });
    if (!bot) throw new AppError('智能体不存在', 404);
    res.json({ success: true, data: bot });
});

// PUT /api/custom-bots/:id — update
router.put('/:id', async (req: AuthRequest, res: Response) => {
    const existing = await prisma.customBot.findFirst({
        where: { id: req.params.id, userId: req.userId!, isActive: true },
    });
    if (!existing) throw new AppError('智能体不存在', 404);

    const { name, description, icon, systemPrompt, pointsPerUse } = req.body;
    const bot = await prisma.customBot.update({
        where: { id: req.params.id },
        data: {
            ...(name?.trim() && { name: name.trim() }),
            ...(description !== undefined && { description: description.trim() }),
            ...(icon && { icon }),
            ...(systemPrompt?.trim() && { systemPrompt: systemPrompt.trim() }),
            ...(pointsPerUse !== undefined && { pointsPerUse: Math.max(1, Math.min(50, Number(pointsPerUse) || 3)) }),
        },
    });

    res.json({ success: true, data: bot });
});

// DELETE /api/custom-bots/:id — soft delete
router.delete('/:id', async (req: AuthRequest, res: Response) => {
    const existing = await prisma.customBot.findFirst({
        where: { id: req.params.id, userId: req.userId!, isActive: true },
    });
    if (!existing) throw new AppError('智能体不存在', 404);

    await prisma.customBot.update({
        where: { id: req.params.id },
        data: { isActive: false },
    });

    res.json({ success: true, message: '已删除' });
});

// POST /api/custom-bots/:id/avatar — upload avatar
router.post('/:id/avatar', avatarUpload.single('avatar'), async (req: AuthRequest, res: Response) => {
    const existing = await prisma.customBot.findFirst({
        where: { id: req.params.id, userId: req.userId!, isActive: true },
    });
    if (!existing) throw new AppError('智能体不存在', 404);
    if (!req.file) throw new AppError('请选择头像图片', 400);

    const avatarUrl = `/api/bot-avatars/${req.file.filename}`;
    await prisma.customBot.update({
        where: { id: req.params.id },
        data: { avatar: avatarUrl },
    });

    res.json({ success: true, data: { avatar: avatarUrl } });
});

// POST /api/custom-bots/:id/documents — add knowledge document (text already parsed by frontend)
router.post('/:id/documents', async (req: AuthRequest, res: Response) => {
    const existing = await prisma.customBot.findFirst({
        where: { id: req.params.id, userId: req.userId!, isActive: true },
        include: { documents: true },
    });
    if (!existing) throw new AppError('智能体不存在', 404);
    if (existing.documents.length >= 10) throw new AppError('每个智能体最多上传 10 个文档', 400);

    const { fileName, fileType, fileSize, parsedText } = req.body;
    if (!fileName || !parsedText?.trim()) throw new AppError('文档内容为空', 400);

    const doc = await prisma.botDocument.create({
        data: {
            customBotId: req.params.id,
            fileName: fileName,
            fileType: fileType || 'unknown',
            fileSize: Number(fileSize) || 0,
            parsedText: parsedText.trim(),
        },
    });

    res.json({ success: true, data: doc });
});

// DELETE /api/custom-bots/:id/documents/:docId — remove a document
router.delete('/:id/documents/:docId', async (req: AuthRequest, res: Response) => {
    const existing = await prisma.customBot.findFirst({
        where: { id: req.params.id, userId: req.userId!, isActive: true },
    });
    if (!existing) throw new AppError('智能体不存在', 404);

    const doc = await prisma.botDocument.findFirst({
        where: { id: req.params.docId, customBotId: req.params.id },
    });
    if (!doc) throw new AppError('文档不存在', 404);

    await prisma.botDocument.delete({ where: { id: req.params.docId } });
    res.json({ success: true, message: '已删除' });
});

export default router;
