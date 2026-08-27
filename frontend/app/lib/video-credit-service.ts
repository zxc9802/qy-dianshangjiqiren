const BASE_POINTS_PER_30_SECONDS_720P = 5_000;

const MODEL_MULTIPLIERS = {
    'doubao-seedance-2-0-fast-260128': 0.5,
    'doubao-seedance-2-0-260128': 1,
    'seedance2.5': 1.5,
} as const;

const RESOLUTION_MULTIPLIERS = {
    '480p': 0.5,
    '720p': 1,
    '1080p': 2,
} as const;

export type ExternalVideoBillingModel = keyof typeof MODEL_MULTIPLIERS;
export type ExternalVideoBillingResolution = keyof typeof RESOLUTION_MULTIPLIERS;

export function calculateExternalVideoPoints(input: {
    model: ExternalVideoBillingModel;
    resolution: ExternalVideoBillingResolution;
    duration: number;
}): number {
    const duration = Number(input.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('Video duration must be greater than 0.');
    }

    return Math.ceil(
        BASE_POINTS_PER_30_SECONDS_720P
        * (duration / 30)
        * MODEL_MULTIPLIERS[input.model]
        * RESOLUTION_MULTIPLIERS[input.resolution],
    );
}

export type VideoBillingActionInput = {
    action: 'reserve' | 'settle' | 'release';
    requestId: string;
    model?: ExternalVideoBillingModel;
    resolution?: ExternalVideoBillingResolution;
    duration?: number;
};

export type VideoBillingUser = {
    id: string;
    billingAudience?: string;
    groupName?: string;
    pointsBalance?: number;
};

export type VideoCreditLedger = {
    reserve(input: {
        userId: string;
        requestId: string;
        amount: number;
        description: string;
    }): Promise<{ pointsBalance: number }>;
    settle(input: {
        userId: string;
        requestId: string;
    }): Promise<{ pointsBalance: number; chargedPoints: number }>;
    release(input: {
        userId: string;
        requestId: string;
    }): Promise<{ pointsBalance: number; releasedPoints: number }>;
};

export async function executeVideoBillingAction(
    input: VideoBillingActionInput,
    user: VideoBillingUser,
    ledger: VideoCreditLedger,
) {
    const chargeRequired = (
        user.billingAudience === 'external'
        || user.groupName === '外部用户'
    );
    if (!chargeRequired) {
        return {
            action: input.action,
            requestId: input.requestId,
            requiredPoints: 0,
            pointsBalance: user.pointsBalance ?? 0,
            chargeRequired: false,
        };
    }

    if (input.action === 'settle') {
        const result = await ledger.settle({
            userId: user.id,
            requestId: input.requestId,
        });
        return {
            action: input.action,
            requestId: input.requestId,
            chargedPoints: result.chargedPoints,
            pointsBalance: result.pointsBalance,
            chargeRequired: true,
        };
    }

    if (input.action === 'release') {
        const result = await ledger.release({
            userId: user.id,
            requestId: input.requestId,
        });
        return {
            action: input.action,
            requestId: input.requestId,
            releasedPoints: result.releasedPoints,
            pointsBalance: result.pointsBalance,
            chargeRequired: true,
        };
    }
    if (!input.model || !input.resolution || !input.duration) {
        throw new Error('Model, resolution and duration are required to reserve video points.');
    }

    const requiredPoints = calculateExternalVideoPoints({
        model: input.model,
        resolution: input.resolution,
        duration: input.duration,
    });
    const result = await ledger.reserve({
        userId: user.id,
        requestId: input.requestId,
        amount: requiredPoints,
        description: `Seedance 视频生成预留 · ${input.model} / ${input.resolution} / ${input.duration}秒`,
    });

    return {
        action: input.action,
        requestId: input.requestId,
        requiredPoints,
        pointsBalance: result.pointsBalance,
        chargeRequired: true,
    };
}
