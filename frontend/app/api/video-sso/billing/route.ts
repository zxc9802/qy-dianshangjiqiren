import { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, getAuthUser } from '@/app/lib/auth';
import { prismaVideoCreditLedger } from '@/app/lib/video-credit-ledger';
import { executeVideoBillingAction } from '@/app/lib/video-credit-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const billingSchema = z.object({
    action: z.enum(['reserve', 'settle', 'release']),
    requestId: z.string().uuid(),
    model: z.enum([
        'doubao-seedance-2-0-fast-260128',
        'doubao-seedance-2-0-260128',
        'seedance2.5',
    ]).optional(),
    resolution: z.enum(['480p', '720p', '1080p']).optional(),
    duration: z.number().positive().max(600).optional(),
}).superRefine((value, context) => {
    if (value.action !== 'reserve') return;
    for (const field of ['model', 'resolution', 'duration'] as const) {
        if (value[field] === undefined) {
            context.addIssue({
                code: 'custom',
                path: [field],
                message: `${field} is required to reserve video points.`,
            });
        }
    }
});

export async function POST(req: NextRequest) {
    try {
        const user = await getAuthUser(req);
        const input = billingSchema.parse(await req.json());
        const result = await executeVideoBillingAction(input, {
            id: user.id,
            groupName: user.groupName,
        }, prismaVideoCreditLedger);
        return Response.json({ success: true, data: result });
    } catch (error) {
        return errorResponse(error);
    }
}
