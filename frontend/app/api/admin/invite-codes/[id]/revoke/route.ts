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

        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: inviteCode.usedByUserId! },
                data: { accessGrantedAt: null },
            });

            await tx.inviteCode.update({
                where: { id: inviteCode.id },
                data: {
                    usedByUserId: null,
                    usedAt: null,
                },
            });
        }, REVOKE_TRANSACTION_OPTIONS);

        return Response.json({ success: true });
    } catch (error) {
        return errorResponse(error);
    }
}
