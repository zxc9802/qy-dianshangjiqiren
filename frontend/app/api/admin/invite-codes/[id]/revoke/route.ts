import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { AppError, errorResponse, getAuthUser } from '../../../../../lib/auth';

const REVOKE_TRANSACTION_OPTIONS = {
    maxWait: 10_000,
    timeout: 20_000,
} as const;

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { id } = await context.params;

        const inviteCode = await prisma.inviteCode.findUnique({
            where: { id },
            select: {
                id: true,
                usedByUserId: true,
            },
        });

        if (!inviteCode) {
            throw new AppError('Invite code not found.', 404);
        }

        if (!inviteCode.usedByUserId) {
            throw new AppError('This invite code is not in use.', 400);
        }

        const targetUserId = inviteCode.usedByUserId;

        await prisma.$transaction(async (tx) => {
            const targetUser = await tx.user.findUnique({
                where: { id: targetUserId },
                select: { role: true },
            });

            if (!targetUser) {
                throw new AppError('Invite code user not found.', 404);
            }

            if (targetUser.role === 'admin') {
                throw new AppError('Admin accounts cannot be deleted by invite-code revocation.', 400);
            }

            await tx.inviteCode.update({
                where: { id: inviteCode.id },
                data: {
                    usedByUserId: null,
                    usedAt: null,
                },
            });

            await tx.invitation.deleteMany({
                where: {
                    OR: [
                        { inviterId: targetUserId },
                        { inviteeId: targetUserId },
                    ],
                },
            });

            await tx.pointsTransaction.deleteMany({
                where: { userId: targetUserId },
            });

            await tx.conversation.deleteMany({
                where: { userId: targetUserId },
            });

            await tx.workflowExecution.deleteMany({
                where: { userId: targetUserId },
            });

            await tx.workflow.deleteMany({
                where: { userId: targetUserId },
            });

            await tx.videoUsageLog.deleteMany({
                where: { userId: targetUserId },
            });

            await tx.user.delete({
                where: { id: targetUserId },
            });
        }, REVOKE_TRANSACTION_OPTIONS);

        return Response.json({ success: true });
    } catch (error) {
        return errorResponse(error);
    }
}
