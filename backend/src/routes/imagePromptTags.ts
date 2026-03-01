import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/error';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { IMAGE_PROMPT_TAG_GROUP_KEY_SET, IMAGE_PROMPT_TAG_GROUPS } from '../constants/imagePromptTagGroups';

const router = Router();

router.use(authMiddleware);

const MAX_CUSTOM_TAGS_PER_USER = 300;

const createTagSchema = z.object({
    groupKey: z.string().min(1).max(50),
    label: z.string().min(1).max(30),
});

function normalizeLabel(input: string): string {
    return input.trim().replace(/\s+/g, ' ');
}

router.get('/', async (req: AuthRequest, res: Response) => {
    const rows = await prisma.imagePromptTag.findMany({
        where: { userId: req.userId },
        orderBy: [{ groupKey: 'asc' }, { createdAt: 'desc' }],
        select: { id: true, userId: true, groupKey: true, label: true, createdAt: true },
    });

    const grouped = IMAGE_PROMPT_TAG_GROUPS.reduce<Record<string, string[]>>((acc, group) => {
        acc[group.key] = rows
            .filter((row) => row.groupKey === group.key)
            .map((row) => row.label);
        return acc;
    }, {});

    res.json({
        success: true,
        data: {
            items: rows,
            grouped,
        },
    });
});

router.post('/', async (req: AuthRequest, res: Response) => {
    const parsed = createTagSchema.parse(req.body);
    const groupKey = parsed.groupKey.trim();
    const label = normalizeLabel(parsed.label);

    if (!IMAGE_PROMPT_TAG_GROUP_KEY_SET.has(groupKey)) {
        throw new AppError('Invalid groupKey', 400);
    }
    if (label.length < 1 || label.length > 30) {
        throw new AppError('label length must be 1-30', 400);
    }

    const total = await prisma.imagePromptTag.count({ where: { userId: req.userId } });
    if (total >= MAX_CUSTOM_TAGS_PER_USER) {
        throw new AppError(`Custom tags limit reached (${MAX_CUSTOM_TAGS_PER_USER})`, 400);
    }

    const duplicate = await prisma.imagePromptTag.findFirst({
        where: { userId: req.userId, groupKey, label },
        select: { id: true },
    });
    if (duplicate) {
        throw new AppError('Tag already exists in this group', 409);
    }

    const created = await prisma.imagePromptTag.create({
        data: {
            userId: req.userId!,
            groupKey,
            label,
        },
        select: { id: true, userId: true, groupKey: true, label: true, createdAt: true },
    });

    res.status(201).json({ success: true, data: created });
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;

    const row = await prisma.imagePromptTag.findFirst({
        where: { id, userId: req.userId },
        select: { id: true },
    });

    if (!row) {
        throw new AppError('Custom tag not found', 404);
    }

    await prisma.imagePromptTag.delete({ where: { id: row.id } });
    res.json({ success: true, message: 'Deleted' });
});

export default router;
