import type { Prisma } from '@prisma/client';

export const VIDEO_CREDIT_RESERVATION_REFERENCE_PREFIX = 'video-sso:hold:';
export const LEGACY_VIDEO_CREDIT_RESERVATION_REFERENCE_PREFIX = 'video-sso:reserve:';

export function videoCreditReservationReference(requestId: string): string {
    return `${VIDEO_CREDIT_RESERVATION_REFERENCE_PREFIX}${requestId}`;
}

export function legacyVideoCreditReservationReference(requestId: string): string {
    return `${LEGACY_VIDEO_CREDIT_RESERVATION_REFERENCE_PREFIX}${requestId}`;
}

export async function readActiveVideoHeldPoints(
    tx: Prisma.TransactionClient,
    userId: string,
): Promise<number> {
    const reservations = await tx.pointsTransaction.aggregate({
        where: {
            userId,
            type: 'reserve',
            referenceKey: {
                startsWith: VIDEO_CREDIT_RESERVATION_REFERENCE_PREFIX,
            },
        },
        _sum: { amount: true },
    });
    return Math.max(0, -(reservations._sum.amount || 0));
}

export function planVideoCreditTransition(input: {
    action: 'reserve' | 'settle' | 'release';
    pointsBalance: number;
    heldPoints: number;
    amount: number;
}) {
    const pointsBalance = Math.max(0, Math.trunc(input.pointsBalance));
    const heldPoints = Math.max(0, Math.trunc(input.heldPoints));
    const amount = Math.max(0, Math.trunc(input.amount));
    if (input.action === 'reserve') {
        const allowed = amount > 0 && pointsBalance - heldPoints >= amount;
        return {
            allowed,
            pointsBalance,
            heldPoints: allowed ? heldPoints + amount : heldPoints,
        };
    }

    const allowed = amount > 0 && heldPoints >= amount;
    if (input.action === 'release') {
        return {
            allowed,
            pointsBalance,
            heldPoints: allowed ? heldPoints - amount : heldPoints,
        };
    }

    return {
        allowed: allowed && pointsBalance >= amount,
        pointsBalance: allowed && pointsBalance >= amount
            ? pointsBalance - amount
            : pointsBalance,
        heldPoints: allowed && pointsBalance >= amount
            ? heldPoints - amount
            : heldPoints,
    };
}
