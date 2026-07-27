import { NextRequest } from 'next/server';
import { getUserId, errorResponse } from '../../../lib/auth';
import { serializeAiUsageNumber } from '../../../lib/ai-usage-store';
import { prisma } from '../../../lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const userId = await getUserId(req);
        const [totals, recent] = await Promise.all([
            prisma.videoUsageLog.aggregate({
                where: { userId, status: 'succeeded' },
                _sum: {
                    inputTokens: true,
                    cachedInputTokens: true,
                    outputTokens: true,
                    reasoningTokens: true,
                    totalTokens: true,
                    upstreamCostCny: true,
                    costCredits: true,
                    chargedCredits: true,
                },
                _count: { _all: true },
            }),
            prisma.videoUsageLog.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: 50,
                select: {
                    id: true,
                    appId: true,
                    channel: true,
                    model: true,
                    status: true,
                    totalTokens: true,
                    upstreamCostCny: true,
                    chargedCredits: true,
                    billingUnit: true,
                    billableUnits: true,
                    priceVersion: true,
                    createdAt: true,
                },
            }),
        ]);

        return Response.json({
            success: true,
            data: {
                totals: {
                    requests: totals._count._all,
                    inputTokens: serializeAiUsageNumber(totals._sum.inputTokens),
                    cachedInputTokens: serializeAiUsageNumber(totals._sum.cachedInputTokens),
                    outputTokens: serializeAiUsageNumber(totals._sum.outputTokens),
                    reasoningTokens: serializeAiUsageNumber(totals._sum.reasoningTokens),
                    totalTokens: serializeAiUsageNumber(totals._sum.totalTokens),
                    upstreamCostCny: serializeAiUsageNumber(totals._sum.upstreamCostCny),
                    costCredits: serializeAiUsageNumber(totals._sum.costCredits),
                    chargedCredits: serializeAiUsageNumber(totals._sum.chargedCredits),
                },
                recent: recent.map((item) => ({
                    ...item,
                    totalTokens: serializeAiUsageNumber(item.totalTokens),
                    upstreamCostCny: serializeAiUsageNumber(item.upstreamCostCny),
                    chargedCredits: serializeAiUsageNumber(item.chargedCredits),
                    billableUnits: serializeAiUsageNumber(item.billableUnits),
                })),
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}
