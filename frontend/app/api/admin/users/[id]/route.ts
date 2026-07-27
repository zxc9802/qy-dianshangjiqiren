import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, errorResponse, getAuthUser } from '../../../../lib/auth';
import { isAllowedGroupName, isAllowedMemberName } from '../../../../lib/member-directory';
import { prisma } from '../../../../lib/prisma';

const updateSchema = z.object({
    billingAudience: z.enum(['internal', 'external']).optional(),
    accountStatus: z.enum(['active', 'suspended']).optional(),
    nickname: z.string().trim().min(1).max(40).optional(),
    groupName: z.string().trim().min(1).max(50).optional(),
}).refine((value) => value.billingAudience || value.accountStatus, {
    message: 'No account change was supplied.',
});

export async function PATCH(
    req: NextRequest,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const admin = await getAuthUser(req, { requireAdmin: true });
        const { id } = await context.params;
        const input = updateSchema.parse(await req.json());
        const target = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                nickname: true,
                groupName: true,
                role: true,
                billingAudience: true,
                accountStatus: true,
            },
        });

        if (!target) {
            throw new AppError('Account not found.', 404);
        }
        if (
            target.role === 'admin'
            && (input.accountStatus === 'suspended' || input.billingAudience === 'external')
        ) {
            throw new AppError('Admin accounts must remain active internal accounts.', 400);
        }
        if (target.id === admin.id && input.accountStatus === 'suspended') {
            throw new AppError('You cannot suspend your own account.', 400);
        }
        const nextNickname = input.nickname || target.nickname;
        const nextGroupName = input.groupName || target.groupName;
        if (
            input.billingAudience === 'internal'
            && (!isAllowedMemberName(nextNickname) || !isAllowedGroupName(nextGroupName))
        ) {
            throw new AppError(
                'Only accounts with a valid internal member name and group can become internal.',
                400,
                'INTERNAL_PROFILE_REQUIRED',
            );
        }

        const updated = await prisma.user.update({
            where: { id: target.id },
            data: {
                ...(input.billingAudience ? { billingAudience: input.billingAudience } : {}),
                ...(input.accountStatus ? { accountStatus: input.accountStatus } : {}),
                ...(input.nickname ? { nickname: input.nickname } : {}),
                ...(input.groupName ? { groupName: input.groupName } : {}),
            },
            select: {
                id: true,
                email: true,
                nickname: true,
                groupName: true,
                role: true,
                billingAudience: true,
                accountStatus: true,
                pointsBalance: true,
                accessGrantedAt: true,
                lastLoginAt: true,
                createdAt: true,
            },
        });

        console.info('[admin-account-change]', {
            adminUserId: admin.id,
            targetUserId: target.id,
            previousBillingAudience: target.billingAudience,
            nextBillingAudience: updated.billingAudience,
            previousAccountStatus: target.accountStatus,
            nextAccountStatus: updated.accountStatus,
        });

        return Response.json({
            success: true,
            data: {
                ...updated,
                account: updated.email,
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}
