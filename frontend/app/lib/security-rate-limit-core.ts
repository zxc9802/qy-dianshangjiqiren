export type RateLimitState = {
    count: number;
    windowStartedAt: Date;
    blockedUntil: Date | null;
};

export type RateLimitOptions = {
    limit: number;
    windowMs: number;
    blockMs: number;
};

export function resolveRateLimitAttempt(
    current: RateLimitState | null,
    now: Date,
    options: RateLimitOptions,
): {
    allowed: boolean;
    retryAfterSeconds: number;
    state: RateLimitState;
} {
    if (current?.blockedUntil && current.blockedUntil.getTime() > now.getTime()) {
        return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((current.blockedUntil.getTime() - now.getTime()) / 1000)),
            state: current,
        };
    }

    const windowExpired = !current
        || now.getTime() - current.windowStartedAt.getTime() >= options.windowMs;
    if (windowExpired) {
        return {
            allowed: true,
            retryAfterSeconds: 0,
            state: {
                count: 1,
                windowStartedAt: now,
                blockedUntil: null,
            },
        };
    }

    const nextCount = current.count + 1;
    if (nextCount <= options.limit) {
        return {
            allowed: true,
            retryAfterSeconds: 0,
            state: {
                count: nextCount,
                windowStartedAt: current.windowStartedAt,
                blockedUntil: null,
            },
        };
    }

    const blockedUntil = new Date(now.getTime() + options.blockMs);
    return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(options.blockMs / 1000)),
        state: {
            count: nextCount,
            windowStartedAt: current.windowStartedAt,
            blockedUntil,
        },
    };
}
