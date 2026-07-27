import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, getAuthUser } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { generateRechargeCode } from '../../../lib/recharge-codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
    points: z.number().int().positive().max(2_147_483_647),
});

async function createUniqueRechargeCode(points: number) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await prisma.redeemCode.create({
                data: {
                    code: generateRechargeCode(),
                    pointsAmount: points,
                },
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                continue;
            }
            throw error;
        }
    }

    throw new Error('Unable to generate a unique recharge code.');
}

export async function GET(req: NextRequest) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const codes = await prisma.redeemCode.findMany({
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        const usedByIds = [...new Set(codes.flatMap((item) => item.usedBy ? [item.usedBy] : []))];
        const users = usedByIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: usedByIds } },
                select: { id: true, email: true, nickname: true },
            })
            : [];
        const userById = new Map(users.map((user) => [user.id, user]));

        return Response.json({
            success: true,
            data: codes.map((item) => ({
                id: item.id,
                code: item.code,
                points: item.pointsAmount,
                isUsed: item.isUsed,
                usedAt: item.usedAt,
                createdAt: item.createdAt,
                usedBy: item.usedBy
                    ? {
                        id: item.usedBy,
                        account: userById.get(item.usedBy)?.email || '',
                        nickname: userById.get(item.usedBy)?.nickname || '',
                    }
                    : null,
            })),
        });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        await getAuthUser(req, { requireAdmin: true });
        const { points } = createSchema.parse(await req.json());
        const created = await createUniqueRechargeCode(points);

        return Response.json({
            success: true,
            data: {
                id: created.id,
                code: created.code,
                points: created.pointsAmount,
                isUsed: created.isUsed,
                usedAt: created.usedAt,
                createdAt: created.createdAt,
                usedBy: null,
            },
        }, { status: 201 });
    } catch (error) {
        return errorResponse(error);
    }
}
