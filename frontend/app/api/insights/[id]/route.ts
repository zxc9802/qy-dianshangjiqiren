import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { getUserId, AppError, errorResponse } from '../../../lib/auth';
import { normalizePageInsightRecord } from '../../../lib/page-insights';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const userId = await getUserId(req);
        const { id } = await params;

        const insight = await prisma.pageInsight.findFirst({
            where: {
                id,
                userId,
            },
        });

        if (!insight) {
            throw new AppError('网页洞察不存在', 404);
        }

        return Response.json({
            success: true,
            data: normalizePageInsightRecord(insight),
        });
    } catch (err) {
        return errorResponse(err);
    }
}
