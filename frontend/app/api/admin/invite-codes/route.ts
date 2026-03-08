import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { AppError, errorResponse, getAuthUser } from '../../../lib/auth';
import { serializeInviteCode } from '../../../lib/invite-codes';

export async function GET(req: NextRequest) {
    try {
        await getAuthUser(req, { requireAdmin: true });

        const { searchParams } = new URL(req.url);
        const batchId = searchParams.get('batchId');
        if (!batchId) {
            throw new AppError('batchId is required.');
        }

        const batch = await prisma.inviteCodeBatch.findUnique({
            where: { id: batchId },
            select: { id: true },
        });

        if (!batch) {
            throw new AppError('Invite batch not found.', 404);
        }

        const codes = await prisma.inviteCode.findMany({
            where: { batchId },
            orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
            include: {
                usedBy: {
                    select: { id: true, email: true, nickname: true, groupName: true },
                },
            },
        });

        return Response.json({
            success: true,
            data: codes.map(serializeInviteCode),
        });
    } catch (error) {
        return errorResponse(error);
    }
}
