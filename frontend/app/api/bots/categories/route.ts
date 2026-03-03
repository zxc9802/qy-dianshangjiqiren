import { prisma } from '../../../lib/prisma';
import { errorResponse } from '../../../lib/auth';

export async function GET() {
    try {
        const bots = await prisma.bot.findMany({
            where: { isActive: true },
            select: { category: true },
            distinct: ['category'],
            orderBy: { sortOrder: 'asc' },
        });
        return Response.json({ success: true, data: bots.map(b => b.category) });
    } catch (err) {
        return errorResponse(err);
    }
}
