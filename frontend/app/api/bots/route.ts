import { NextRequest } from 'next/server';
import { prisma } from '../../lib/prisma';
import { errorResponse } from '../../lib/auth';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const category = searchParams.get('category');
        const search = searchParams.get('search');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: any = { isActive: true };
        if (category) where.category = category;
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }

        const bots = await prisma.bot.findMany({
            where,
            select: { id: true, name: true, slug: true, category: true, icon: true, description: true, pointsPerUse: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });

        return Response.json({ success: true, data: bots });
    } catch (err) {
        return errorResponse(err);
    }
}
