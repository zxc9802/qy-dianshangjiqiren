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
    destination: (_req, _file, callback) => callback(null, AVATAR_DIR),
    filename: (_req, file, callback) => {
        const ext = path.extname(file.originalname);
        callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
});

const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const ext = path.extname(file.originalname).toLowerCase();
        callback(null, allowed.includes(ext));
    },
});

router.get('/', async (req: AuthRequest, res: Response) => {
    const bots = await prisma.customBot.findMany({
        where: { userId: req.userId!, isActive: true },
        include: { documents: { select: { id: true, fileName: true, fileType: true, fileSize: true, createdAt: true } } },
        orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: bots });
});

router.post('/', async (req: AuthRequest, res: Response) => {
    const { name, description, icon, systemPrompt, pointsPerUse } = req.body;
    if (!name?.trim()) throw new AppError('Please enter a bot name', 400);
    if (!systemPrompt?.trim()) throw new AppError('Please enter a system prompt', 400);

    const count = await prisma.customBot.count({ where: { userId: req.userId!, isActive: true } });
    if (count >= 20) throw new AppError('You can create up to 20 custom bots', 400);

    const bot = await prisma.customBot.create({
        data: {
            userId: req.userId!,
            name: name.trim(),
            description: String(description || '').trim(),
            icon: icon || 'bot',
            systemPrompt: systemPrompt.trim(),
            pointsPerUse: Math.max(1, Math.min(50, Number(pointsPerUse) || 3)),
        },
    });

    res.json({ success: true, data: bot });
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
    const botId = String(req.params.id);
    const bot = await prisma.customBot.findFirst({
        where: { id: botId, userId: req.userId!, isActive: true },
        include: { documents: { orderBy: { createdAt: 'desc' } } },
    });
    if (!bot) throw new AppError('Custom bot not found', 404);
    res.json({ success: true, data: bot });
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
    const botId = String(req.params.id);
    const existing = await prisma.customBot.findFirst({
        where: { id: botId, userId: req.userId!, isActive: true },
    });
    if (!existing) throw new AppError('Custom bot not found', 404);

    const { name, description, icon, systemPrompt, pointsPerUse } = req.body;
    const bot = await prisma.customBot.update({
        where: { id: botId },
        data: {
            ...(name?.trim() && { name: name.trim() }),
            ...(description !== undefined && { description: String(description).trim() }),
            ...(icon && { icon }),
            ...(systemPrompt?.trim() && { systemPrompt: systemPrompt.trim() }),
            ...(pointsPerUse !== undefined && { pointsPerUse: Math.max(1, Math.min(50, Number(pointsPerUse) || 3)) }),
        },
    });

    res.json({ success: true, data: bot });
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
    const botId = String(req.params.id);
    const existing = await prisma.customBot.findFirst({
        where: { id: botId, userId: req.userId!, isActive: true },
    });
    if (!existing) throw new AppError('Custom bot not found', 404);

    await prisma.customBot.update({
        where: { id: botId },
        data: { isActive: false },
    });

    res.json({ success: true, message: 'Deleted' });
});

router.post('/:id/avatar', avatarUpload.single('avatar'), async (req: AuthRequest, res: Response) => {
    const botId = String(req.params.id);
    const existing = await prisma.customBot.findFirst({
        where: { id: botId, userId: req.userId!, isActive: true },
    });
    if (!existing) throw new AppError('Custom bot not found', 404);
    if (!req.file) throw new AppError('Please choose an avatar image', 400);

    const avatarUrl = `/api/bot-avatars/${req.file.filename}`;
    await prisma.customBot.update({
        where: { id: botId },
        data: { avatar: avatarUrl },
    });

    res.json({ success: true, data: { avatar: avatarUrl } });
});

router.post('/:id/documents', async (req: AuthRequest, res: Response) => {
    const botId = String(req.params.id);
    const existing = await prisma.customBot.findFirst({
        where: { id: botId, userId: req.userId!, isActive: true },
        include: { documents: true },
    });
    if (!existing) throw new AppError('Custom bot not found', 404);
    if (existing.documents.length >= 10) throw new AppError('A custom bot can have up to 10 documents', 400);

    const { fileName, fileType, fileSize, parsedText } = req.body;
    if (!fileName || !parsedText?.trim()) throw new AppError('Document content is empty', 400);

    const document = await prisma.botDocument.create({
        data: {
            customBotId: botId,
            fileName: String(fileName),
            fileType: String(fileType || 'unknown'),
            fileSize: Number(fileSize) || 0,
            parsedText: parsedText.trim(),
        },
    });

    res.json({ success: true, data: document });
});

router.post('/:id/documents/batch', async (req: AuthRequest, res: Response) => {
    const botId = String(req.params.id);
    const existing = await prisma.customBot.findFirst({
        where: { id: botId, userId: req.userId!, isActive: true },
        include: { documents: { select: { id: true } } },
    });
    if (!existing) throw new AppError('Custom bot not found', 404);

    const rawDocuments = Array.isArray(req.body?.documents) ? req.body.documents : [];
    if (rawDocuments.length === 0) {
        res.json({ success: true, data: { count: 0 } });
        return;
    }

    if (existing.documents.length + rawDocuments.length > 10) {
        throw new AppError('A custom bot can have up to 10 documents', 400);
    }

    const documents = rawDocuments.map((item: unknown) => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const fileName = String(record.fileName || '').trim();
        const parsedText = String(record.parsedText || '').trim();

        if (!fileName || !parsedText) {
            throw new AppError('Document content is empty', 400);
        }

        return {
            customBotId: botId,
            fileName,
            fileType: String(record.fileType || 'unknown'),
            fileSize: Number(record.fileSize) || 0,
            parsedText,
        };
    });

    await prisma.botDocument.createMany({
        data: documents,
    });

    res.json({ success: true, data: { count: documents.length } });
});

router.delete('/:id/documents/:docId', async (req: AuthRequest, res: Response) => {
    const botId = String(req.params.id);
    const docId = String(req.params.docId);

    const existing = await prisma.customBot.findFirst({
        where: { id: botId, userId: req.userId!, isActive: true },
    });
    if (!existing) throw new AppError('Custom bot not found', 404);

    const document = await prisma.botDocument.findFirst({
        where: { id: docId, customBotId: botId },
    });
    if (!document) throw new AppError('Document not found', 404);

    await prisma.botDocument.delete({ where: { id: docId } });
    res.json({ success: true, message: 'Deleted' });
});

export default router;
