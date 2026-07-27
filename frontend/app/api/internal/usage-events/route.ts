import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { recordAiUsageEvent } from '../../../lib/ai-usage-store';
import { readServerEnv } from '../../../lib/server-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const usageSchema = z.object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative().default(0),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().default(0),
    totalTokens: z.number().int().nonnegative(),
});

const eventSchema = z.object({
    userId: z.string().trim().min(1).max(191),
    userEmail: z.string().trim().max(320).nullish(),
    userNickname: z.string().trim().max(191).nullish(),
    userGroup: z.string().trim().max(191).nullish(),
    billingAudience: z.enum(['internal', 'external']).default('external'),
    appId: z.string().trim().min(1).max(100),
    channel: z.string().trim().min(1).max(100),
    providerId: z.string().trim().max(100).nullish(),
    model: z.string().trim().min(1).max(191),
    requestId: z.string().trim().min(1).max(191),
    upstreamRequestId: z.string().trim().max(191).nullish(),
    upstreamTraceId: z.string().trim().max(191).nullish(),
    upstreamUrl: z.string().trim().url().max(2048).nullish(),
    status: z.enum(['succeeded', 'failed']).default('succeeded'),
    errorMessage: z.string().trim().max(1000).nullish(),
    usage: usageSchema.nullish(),
    usageSource: z.enum(['response', 'yunwu_log', 'estimated']).default('response'),
    groupMultiplier: z.number().positive().max(100).default(1),
    usdCnyRate: z.number().positive().max(100).default(7.3),
    mediaProduct: z.enum(['seedance2', 'seedance2-fast', 'nanobanana2']).optional(),
    billableUnits: z.number().positive().max(1_000_000).optional(),
}).superRefine((value, context) => {
    if (value.status === 'succeeded' && !value.usage && !value.mediaProduct) {
        context.addIssue({
            code: 'custom',
            message: 'A succeeded event requires usage or mediaProduct.',
        });
    }
    if (value.mediaProduct && !value.billableUnits) {
        context.addIssue({
            code: 'custom',
            message: 'billableUnits is required for fixed media billing.',
        });
    }
});

function secretsMatch(expected: string, actual: string): boolean {
    const expectedBytes = Buffer.from(expected);
    const actualBytes = Buffer.from(actual);
    return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export async function POST(req: Request) {
    const expectedSecret = readServerEnv('USAGE_MONITOR_INTERNAL_SECRET')?.trim();
    if (!expectedSecret) {
        return Response.json({ error: 'Usage monitor is not configured.' }, { status: 503 });
    }

    const actualSecret = req.headers.get('x-usage-monitor-secret')?.trim() || '';
    if (!actualSecret || !secretsMatch(expectedSecret, actualSecret)) {
        return Response.json({ error: 'Unauthorized usage reporter.' }, { status: 401 });
    }

    try {
        const input = eventSchema.parse(await req.json());
        const saved = await recordAiUsageEvent(input);
        return Response.json({
            success: true,
            data: {
                ...saved,
                totalTokens: Number(saved.totalTokens || 0),
                upstreamCostCny: Number(saved.upstreamCostCny || 0),
                chargedCredits: Number(saved.chargedCredits || 0),
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return Response.json({
                error: error.issues[0]?.message || 'Invalid usage event.',
            }, { status: 400 });
        }

        console.error('[usage-monitor] Failed to ingest usage event:', error);
        return Response.json({ error: 'Failed to store usage event.' }, { status: 500 });
    }
}
