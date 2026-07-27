import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppError } from './auth';
import { prisma } from './prisma';
import { resolveRateLimitAttempt } from './security-rate-limit-core';
import {
    isRetryableTransactionError,
    waitForTransactionRetry,
} from './transaction-retry';

const RATE_LIMIT_TRANSACTION_OPTIONS = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 10_000,
} as const;
const RATE_LIMIT_TRANSACTION_ATTEMPTS = 3;

export function getClientAddress(req: Request): string {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const direct = req.headers.get('x-real-ip')?.trim();
    return (forwarded || direct || 'unknown').slice(0, 128);
}

function buildRateLimitKey(scope: string, identifier: string): string {
    return createHash('sha256')
        .update(`${scope.trim()}:${identifier.trim().toLowerCase()}`)
        .digest('hex');
}

export async function enforceRateLimit(input: {
    scope: string;
    identifier: string;
    limit: number;
    windowMs: number;
    blockMs?: number;
}): Promise<void> {
    const key = buildRateLimitKey(input.scope, input.identifier);
    const options = {
        limit: input.limit,
        windowMs: input.windowMs,
        blockMs: input.blockMs ?? input.windowMs,
    };

    for (let attempt = 0; attempt < RATE_LIMIT_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
            const decision = await prisma.$transaction(async (tx) => {
                const current = await tx.requestRateLimit.findUnique({
                    where: { key },
                    select: {
                        count: true,
                        windowStartedAt: true,
                        blockedUntil: true,
                    },
                });
                const next = resolveRateLimitAttempt(current, new Date(), options);

                await tx.requestRateLimit.upsert({
                    where: { key },
                    create: {
                        key,
                        count: next.state.count,
                        windowStartedAt: next.state.windowStartedAt,
                        blockedUntil: next.state.blockedUntil,
                    },
                    update: {
                        count: next.state.count,
                        windowStartedAt: next.state.windowStartedAt,
                        blockedUntil: next.state.blockedUntil,
                    },
                });

                return next;
            }, RATE_LIMIT_TRANSACTION_OPTIONS);

            if (!decision.allowed) {
                throw new AppError(
                    `Too many requests. Please retry in ${decision.retryAfterSeconds} seconds.`,
                    429,
                    'RATE_LIMITED',
                );
            }
            return;
        } catch (error) {
            if (!isRetryableTransactionError(error)) {
                throw error;
            }
            if (attempt >= RATE_LIMIT_TRANSACTION_ATTEMPTS - 1) {
                break;
            }
            await waitForTransactionRetry(attempt);
        }
    }

    throw new AppError('Unable to verify request rate limit.', 503, 'RATE_LIMIT_UNAVAILABLE');
}
