import { NextRequest } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { errorResponse, getAuthUser } from '../../../lib/auth';
import { serializeInviteCodeUsage } from '../../../lib/invite-codes';

export async function GET(req: NextRequest) {
    try {
        await getAuthUser(req, { requireAdmin: true });

        const { searchParams } = new URL(req.url);
        const keyword = searchParams.get('keyword')?.trim() || '';

        if (!keyword) {
            return Response.json({
                success: true,
                data: [],
            });
        }

        const usageRecords = await prisma.inviteCode.findMany({
            where: {
                usedByUserId: { not: null },
                usedBy: {
                    is: {
                        OR: [
                            { email: { contains: keyword, mode: 'insensitive' } },
                            { nickname: { contains: keyword, mode: 'insensitive' } },
                            { groupName: { contains: keyword, mode: 'insensitive' } },
                        ],
                    },
                },
            },
            orderBy: [
                { usedAt: 'desc' },
                { createdAt: 'desc' },
            ],
            take: 100,
            include: {
                batch: {
                    select: {
                        createdAt: true,
                        remark: true,
                    },
                },
                usedBy: {
                    select: {
                        id: true,
                        email: true,
                        nickname: true,
                        groupName: true,
                    },
                },
            },
        });

        return Response.json({
            success: true,
            data: usageRecords.map(serializeInviteCodeUsage),
        });
    } catch (error) {
        return errorResponse(error);
    }
}
