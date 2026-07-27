import { NextRequest } from 'next/server';
import { errorResponse, getAuthUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const searchParams = new URL(req.url).searchParams;
        const keyword = searchParams.get('q')?.trim() || '';
        const billingAudience = searchParams.get('billingAudience');
        const accountStatus = searchParams.get('accountStatus');
        const take = Math.min(500, Math.max(1, Number(searchParams.get('limit')) || 200));

        const where = {
            ...(billingAudience === 'internal' || billingAudience === 'external'
                ? { billingAudience }
                : {}),
            ...(accountStatus === 'active' || accountStatus === 'suspended'
                ? { accountStatus }
                : {}),
            ...(keyword
                ? {
                    OR: [
                        { email: { contains: keyword, mode: 'insensitive' as const } },
                        { nickname: { contains: keyword, mode: 'insensitive' as const } },
                        { groupName: { contains: keyword, mode: 'insensitive' as const } },
                    ],
                }
                : {}),
        };

        const [rows, total, internal, external, suspended] = await Promise.all([
            prisma.user.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take,
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
            }),
            prisma.user.count(),
            prisma.user.count({ where: { billingAudience: 'internal' } }),
            prisma.user.count({ where: { billingAudience: 'external' } }),
            prisma.user.count({ where: { accountStatus: 'suspended' } }),
        ]);

        return Response.json({
            success: true,
            data: {
                totals: { total, internal, external, suspended },
                rows: rows.map((user) => ({
                    id: user.id,
                    account: user.email,
                    nickname: user.nickname,
                    groupName: user.groupName,
                    role: user.role,
                    billingAudience: user.billingAudience,
                    accountStatus: user.accountStatus,
                    pointsBalance: user.pointsBalance,
                    accessGrantedAt: user.accessGrantedAt,
                    lastLoginAt: user.lastLoginAt,
                    createdAt: user.createdAt,
                })),
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}
