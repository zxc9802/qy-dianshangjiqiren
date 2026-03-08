import { NextRequest } from 'next/server';
import { prisma } from '../../lib/prisma';
import { getUserId, errorResponse } from '../../lib/auth';
import { normalizePageInsightRecord } from '../../lib/page-insights';

export async function GET(req: NextRequest) {
    try {
        const userId = await getUserId(req);
        const { searchParams } = new URL(req.url);
        const limit = Math.min(Number(searchParams.get('limit') || '30'), 100);

        const insights = await prisma.pageInsight.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            take: limit,
        });

        return Response.json({
            success: true,
            data: insights.map(normalizePageInsightRecord),
        });
    } catch (err) {
        return errorResponse(err);
    }
}
