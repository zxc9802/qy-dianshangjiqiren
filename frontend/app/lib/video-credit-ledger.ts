import { Prisma } from '@prisma/client';
import { AppError } from './auth';
import { prisma } from './prisma';
import type { VideoCreditLedger } from './video-credit-service';

const TRANSACTION_OPTIONS = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 20_000,
} as const;
const TRANSACTION_ATTEMPTS = 3;

let schemaPromise: Promise<void> | null = null;

function reserveReference(requestId: string): string {
    return `video-sso:reserve:${requestId}`;
}

function refundReference(requestId: string): string {
    return `video-sso:refund:${requestId}`;
}

async function ensureVideoCreditLedgerSchema(): Promise<void> {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await prisma.$executeRawUnsafe(`
                ALTER TABLE points_transactions
                ADD COLUMN IF NOT EXISTS reference_key TEXT
            `);
            await prisma.$executeRawUnsafe(`
                CREATE UNIQUE INDEX IF NOT EXISTS points_transactions_reference_key_key
                ON points_transactions(reference_key)
                WHERE reference_key IS NOT NULL
            `);
            await prisma.$executeRawUnsafe(`
                CREATE INDEX IF NOT EXISTS points_transactions_user_id_created_at_idx
                ON points_transactions(user_id, created_at DESC)
            `);
        })().catch((error) => {
            schemaPromise = null;
            throw error;
        });
    }
    await schemaPromise;
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            const retryable = (
                error instanceof Prisma.PrismaClientKnownRequestError
                && (error.code === 'P2002' || error.code === 'P2034')
                && attempt < TRANSACTION_ATTEMPTS - 1
            );
            if (!retryable) throw error;
        }
    }
    throw new AppError('Video credit ledger is temporarily unavailable.', 503, 'VIDEO_CREDIT_LEDGER_UNAVAILABLE');
}

async function readBalance(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const user = await tx.user.findUnique({
        where: { id: userId },
        select: { pointsBalance: true },
    });
    if (!user) throw new AppError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');
    return user.pointsBalance;
}

export const prismaVideoCreditLedger: VideoCreditLedger = {
    async reserve(input) {
        await ensureVideoCreditLedgerSchema();
        return withRetry(() => prisma.$transaction(async (tx) => {
            const referenceKey = reserveReference(input.requestId);
            const existing = await tx.pointsTransaction.findUnique({
                where: { referenceKey },
                select: { userId: true, amount: true },
            });
            if (existing) {
                if (existing.userId !== input.userId) {
                    throw new AppError('Video credit reservation belongs to another account.', 409, 'VIDEO_CREDIT_OWNER_MISMATCH');
                }
                return { pointsBalance: await readBalance(tx, input.userId) };
            }

            const claimed = await tx.user.updateMany({
                where: {
                    id: input.userId,
                    groupName: '外部用户',
                    pointsBalance: { gte: input.amount },
                },
                data: { pointsBalance: { decrement: input.amount } },
            });
            if (claimed.count !== 1) {
                throw new AppError(
                    `积分不足，本次生成需要 ${input.amount} 积分。`,
                    402,
                    'INSUFFICIENT_CREDITS',
                );
            }

            const pointsBalance = await readBalance(tx, input.userId);
            await tx.pointsTransaction.create({
                data: {
                    userId: input.userId,
                    type: 'reserve',
                    amount: -input.amount,
                    balanceAfter: pointsBalance,
                    description: input.description,
                    referenceKey,
                },
            });
            return { pointsBalance };
        }, TRANSACTION_OPTIONS));
    },

    async settle(input) {
        await ensureVideoCreditLedgerSchema();
        return withRetry(() => prisma.$transaction(async (tx) => {
            const referenceKey = reserveReference(input.requestId);
            const reservation = await tx.pointsTransaction.findUnique({
                where: { referenceKey },
                select: { id: true, userId: true, type: true, amount: true },
            });
            if (!reservation) {
                throw new AppError('Video credit reservation was not found.', 409, 'VIDEO_CREDIT_RESERVATION_NOT_FOUND');
            }
            if (reservation.userId !== input.userId) {
                throw new AppError('Video credit reservation belongs to another account.', 409, 'VIDEO_CREDIT_OWNER_MISMATCH');
            }
            const chargedPoints = Math.max(0, -reservation.amount);
            if (reservation.type === 'reserve') {
                await tx.pointsTransaction.update({
                    where: { id: reservation.id },
                    data: {
                        type: 'consume',
                        description: `Seedance 视频生成扣费 · 实扣 ${chargedPoints} 积分`,
                    },
                });
            } else if (reservation.type !== 'consume') {
                throw new AppError('Released video credits cannot be settled.', 409, 'VIDEO_CREDIT_ALREADY_RELEASED');
            }
            return {
                pointsBalance: await readBalance(tx, input.userId),
                chargedPoints,
            };
        }, TRANSACTION_OPTIONS));
    },

    async release(input) {
        await ensureVideoCreditLedgerSchema();
        return withRetry(() => prisma.$transaction(async (tx) => {
            const reserveKey = reserveReference(input.requestId);
            const reservation = await tx.pointsTransaction.findUnique({
                where: { referenceKey: reserveKey },
                select: { id: true, userId: true, type: true, amount: true },
            });
            if (!reservation) {
                return {
                    pointsBalance: await readBalance(tx, input.userId),
                    releasedPoints: 0,
                };
            }
            if (reservation.userId !== input.userId) {
                throw new AppError('Video credit reservation belongs to another account.', 409, 'VIDEO_CREDIT_OWNER_MISMATCH');
            }
            const releasedPoints = Math.max(0, -reservation.amount);
            if (reservation.type === 'consume') {
                return {
                    pointsBalance: await readBalance(tx, input.userId),
                    releasedPoints: 0,
                };
            }
            if (reservation.type === 'reserve') {
                const updatedUser = await tx.user.update({
                    where: { id: input.userId },
                    data: { pointsBalance: { increment: releasedPoints } },
                    select: { pointsBalance: true },
                });
                await tx.pointsTransaction.update({
                    where: { id: reservation.id },
                    data: { type: 'released' },
                });
                await tx.pointsTransaction.create({
                    data: {
                        userId: input.userId,
                        type: 'refund',
                        amount: releasedPoints,
                        balanceAfter: updatedUser.pointsBalance,
                        description: 'Seedance 视频生成未成功，已退回预留积分',
                        referenceKey: refundReference(input.requestId),
                    },
                });
                return {
                    pointsBalance: updatedUser.pointsBalance,
                    releasedPoints,
                };
            }
            return {
                pointsBalance: await readBalance(tx, input.userId),
                releasedPoints,
            };
        }, TRANSACTION_OPTIONS));
    },
};
