import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../lib/auth';

const IMAGE_PROMPT_TAG_GROUPS = [
    { key: 'platform', title: '平台定位' }, { key: 'category', title: '商品类目' },
    { key: 'composition', title: '构图方式' }, { key: 'camera', title: '镜头视角' },
    { key: 'style', title: '风格模板' }, { key: 'background', title: '背景样式' },
    { key: 'lighting', title: '光线风格' }, { key: 'material', title: '材质表现' },
    { key: 'colorMood', title: '色彩氛围' }, { key: 'scene', title: '场景类型' },
    { key: 'model', title: '人群模特' }, { key: 'action', title: '动作状态' },
    { key: 'sellingPoint', title: '卖点强化' }, { key: 'copyLayout', title: '文案版式' },
    { key: 'props', title: '道具元素' }, { key: 'brandTone', title: '品牌调性' },
    { key: 'campaign', title: '营销节点' }, { key: 'output', title: '输出质量与约束' },
];
const GROUP_KEY_SET = new Set(IMAGE_PROMPT_TAG_GROUPS.map(g => g.key));
const MAX_TAGS = 300;

const createSchema = z.object({
    groupKey: z.string().min(1).max(50),
    label: z.string().min(1).max(30),
});

export async function GET(req: NextRequest) {
    try {
        const userId = getUserId(req);
        const rows = await prisma.imagePromptTag.findMany({
            where: { userId },
            orderBy: [{ groupKey: 'asc' }, { createdAt: 'desc' }],
            select: { id: true, userId: true, groupKey: true, label: true, createdAt: true },
        });

        const grouped = IMAGE_PROMPT_TAG_GROUPS.reduce<Record<string, string[]>>((acc, group) => {
            acc[group.key] = rows.filter(r => r.groupKey === group.key).map(r => r.label);
            return acc;
        }, {});

        return Response.json({ success: true, data: { items: rows, grouped } });
    } catch (err) {
        return errorResponse(err);
    }
}

export async function POST(req: NextRequest) {
    try {
        const userId = getUserId(req);
        const parsed = createSchema.parse(await req.json());
        const groupKey = parsed.groupKey.trim();
        const label = parsed.label.trim().replace(/\s+/g, ' ');

        if (!GROUP_KEY_SET.has(groupKey)) throw new AppError('Invalid groupKey');
        if (label.length < 1 || label.length > 30) throw new AppError('label length must be 1-30');

        const total = await prisma.imagePromptTag.count({ where: { userId } });
        if (total >= MAX_TAGS) throw new AppError(`Custom tags limit reached (${MAX_TAGS})`);

        const duplicate = await prisma.imagePromptTag.findFirst({ where: { userId, groupKey, label } });
        if (duplicate) throw new AppError('Tag already exists in this group', 409);

        const created = await prisma.imagePromptTag.create({
            data: { userId, groupKey, label },
            select: { id: true, userId: true, groupKey: true, label: true, createdAt: true },
        });

        return Response.json({ success: true, data: created }, { status: 201 });
    } catch (err) {
        return errorResponse(err);
    }
}
