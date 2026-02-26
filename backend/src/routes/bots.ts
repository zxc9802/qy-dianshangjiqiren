import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/error';

const router = Router();

// 获取所有分类
router.get('/categories', async (_req: Request, res: Response) => {
    const bots = await prisma.bot.findMany({
        where: { isActive: true },
        select: { category: true },
        distinct: ['category'],
        orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: bots.map(b => b.category) });
});

// 获取所有智能体
router.get('/', async (req: Request, res: Response) => {
    const { category, search } = req.query;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { isActive: true };
    if (category && typeof category === 'string') where.category = category;
    if (search && typeof search === 'string') {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
        ];
    }

    const bots = await prisma.bot.findMany({
        where,
        select: {
            id: true, name: true, slug: true, category: true,
            icon: true, description: true, pointsPerUse: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    res.json({ success: true, data: bots });
});

// 获取单个智能体详情
router.get('/:id', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const bot = await prisma.bot.findUnique({
        where: { id },
        select: {
            id: true, name: true, slug: true, category: true,
            icon: true, description: true, pointsPerUse: true,
        },
    });
    if (!bot) throw new AppError('智能体不存在', 404);
    res.json({ success: true, data: bot });
});

export default router;
