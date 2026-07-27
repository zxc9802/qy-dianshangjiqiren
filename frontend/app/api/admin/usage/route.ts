import { NextRequest } from 'next/server';
import { getAuthUser, errorResponse } from '../../../lib/auth';
import { serializeAiUsageNumber } from '../../../lib/ai-usage-store';
import { prisma } from '../../../lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const searchParams = new URL(req.url).searchParams;
        const userId = searchParams.get('userId')?.trim();
        const appId = searchParams.get('appId')?.trim();
        const model = searchParams.get('model')?.trim();
        const take = Math.min(500, Math.max(1, Number(searchParams.get('limit')) || 100));
        const where = {
            ...(userId ? { userId } : {}),
            ...(appId ? { appId } : {}),
            ...(model ? { model } : {}),
        };
        const [totals, rows] = await Promise.all([
            prisma.videoUsageLog.aggregate({
                where: { ...where, status: 'succeeded' },
                _sum: {
                    totalTokens: true,
                    upstreamCostCny: true,
                    costCredits: true,
                    chargedCredits: true,
                },
                _count: { _all: true },
            }),
            prisma.videoUsageLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
            }),
        ]);

        return Response.json({
            success: true,
            data: {
                totals: {
                    requests: totals._count._all,
                    totalTokens: serializeAiUsageNumber(totals._sum.totalTokens),
                    upstreamCostCny: serializeAiUsageNumber(totals._sum.upstreamCostCny),
                    costCredits: serializeAiUsageNumber(totals._sum.costCredits),
                    chargedCredits: serializeAiUsageNumber(totals._sum.chargedCredits),
                },
                rows: rows.map((row) => ({
                    ...row,
                    inputTokens: serializeAiUsageNumber(row.inputTokens),
                    cachedInputTokens: serializeAiUsageNumber(row.cachedInputTokens),
                    outputTokens: serializeAiUsageNumber(row.outputTokens),
                    reasoningTokens: serializeAiUsageNumber(row.reasoningTokens),
                    totalTokens: serializeAiUsageNumber(row.totalTokens),
                    upstreamCostUsd: serializeAiUsageNumber(row.upstreamCostUsd),
                    upstreamCostCny: serializeAiUsageNumber(row.upstreamCostCny),
                    groupMultiplier: serializeAiUsageNumber(row.groupMultiplier),
                    saleMultiplier: serializeAiUsageNumber(row.saleMultiplier),
                    costCredits: serializeAiUsageNumber(row.costCredits),
                    chargedCredits: serializeAiUsageNumber(row.chargedCredits),
                    billableUnits: serializeAiUsageNumber(row.billableUnits),
                })),
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}
