import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '../../../../lib/prisma';
import { AppError, errorResponse, getAuthUser } from '../../../../lib/auth';
import { serializeInviteCodeBatch } from '../../../../lib/invite-codes';

const updateBatchSchema = z.object({
    remark: z.string().trim().max(100, 'Remark is too long.'),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { id } = await params;
        const { remark } = updateBatchSchema.parse(await req.json());

        const updated = await prisma.inviteCodeBatch.update({
            where: { id },
            data: { remark },
            select: {
                id: true,
                count: true,
                remark: true,
                createdAt: true,
                createdBy: {
                    select: { id: true, email: true, nickname: true },
                },
                codes: {
                    select: { usedByUserId: true },
                },
            },
        });

        if (!updated) {
            throw new AppError('Invite batch not found.', 404);
        }

        return Response.json({
            success: true,
            data: serializeInviteCodeBatch(updated),
        });
    } catch (error) {
        return errorResponse(error);
    }
}
