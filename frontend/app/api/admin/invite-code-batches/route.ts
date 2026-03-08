import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { errorResponse, getAuthUser } from '../../../lib/auth';
import { generateUniqueInviteCodes, serializeInviteCode, serializeInviteCodeBatch } from '../../../lib/invite-codes';

const createSchema = z.object({
    count: z.number().int().min(1).max(500),
});

const INVITE_BATCH_TRANSACTION_OPTIONS = {
    maxWait: 10_000,
    timeout: 20_000,
} as const;

export async function GET(req: NextRequest) {
    try {
        await getAuthUser(req, { requireAdmin: true });

        const batches = await prisma.inviteCodeBatch.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
                createdBy: {
                    select: { id: true, email: true, nickname: true },
                },
                codes: {
                    select: { usedByUserId: true },
                },
            },
        });

        return Response.json({
            success: true,
            data: batches.map(serializeInviteCodeBatch),
        });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const admin = await getAuthUser(req, { requireAdmin: true });
        const { count } = createSchema.parse(await req.json());
        const values = await generateUniqueInviteCodes(prisma, count);

        const result = await prisma.$transaction(async (tx) => {
            const batch = await tx.inviteCodeBatch.create({
                data: {
                    createdByUserId: admin.id,
                    count,
                },
                select: {
                    id: true,
                    count: true,
                    remark: true,
                    createdAt: true,
                    createdBy: {
                        select: { id: true, email: true, nickname: true },
                    },
                },
            });

            await tx.inviteCode.createMany({
                data: values.map((code) => ({
                    batchId: batch.id,
                    code,
                    createdByUserId: admin.id,
                })),
            });

            const createdCodes = await tx.inviteCode.findMany({
                where: { batchId: batch.id },
                orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
                include: {
                    usedBy: {
                        select: { id: true, email: true, nickname: true, groupName: true },
                    },
                },
            });

            return {
                batch: serializeInviteCodeBatch({
                    ...batch,
                    codes: createdCodes.map((item) => ({ usedByUserId: item.usedByUserId })),
                }),
                codes: createdCodes.map(serializeInviteCode),
            };
        }, INVITE_BATCH_TRANSACTION_OPTIONS);

        return Response.json({ success: true, data: result }, { status: 201 });
    } catch (error) {
        return errorResponse(error);
    }
}
