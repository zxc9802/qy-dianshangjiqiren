import { Prisma, PrismaClient } from '@prisma/client';

const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 10;

function randomInviteCode(): string {
    let result = '';
    for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
        const nextIndex = Math.floor(Math.random() * INVITE_CODE_ALPHABET.length);
        result += INVITE_CODE_ALPHABET[nextIndex];
    }
    return result;
}

type InviteCodeLookupClient = Pick<PrismaClient, 'inviteCode'> | Prisma.TransactionClient;

export async function generateUniqueInviteCodes(client: InviteCodeLookupClient, count: number): Promise<string[]> {
    const codes = new Set<string>();

    while (codes.size < count) {
        const candidateCount = Math.max((count - codes.size) * 2, 8);
        for (let index = 0; index < candidateCount; index += 1) {
            codes.add(randomInviteCode());
        }

        const existing = await client.inviteCode.findMany({
            where: { code: { in: Array.from(codes) } },
            select: { code: true },
        });

        for (const item of existing) {
            codes.delete(item.code);
        }
    }

    return Array.from(codes).slice(0, count);
}

export function serializeInviteCode(item: {
    id: string;
    code: string;
    batchId: string;
    createdAt: Date;
    usedAt: Date | null;
    usedBy?: {
        id: string;
        email: string;
        nickname: string;
        groupName: string;
    } | null;
}) {
    return {
        id: item.id,
        code: item.code,
        batchId: item.batchId,
        createdAt: item.createdAt.toISOString(),
        usedAt: item.usedAt ? item.usedAt.toISOString() : null,
        canRevoke: Boolean(item.usedBy),
        usedBy: item.usedBy ? {
            id: item.usedBy.id,
            account: item.usedBy.email,
            nickname: item.usedBy.nickname,
            groupName: item.usedBy.groupName,
        } : null,
    };
}

export function serializeInviteCodeBatch(item: {
    id: string;
    count: number;
    remark: string;
    createdAt: Date;
    createdBy: {
        id: string;
        email: string;
        nickname: string;
    };
    codes: Array<{ usedByUserId: string | null }>;
}) {
    const usedCount = item.codes.filter((code) => Boolean(code.usedByUserId)).length;
    return {
        id: item.id,
        count: item.count,
        remark: item.remark,
        createdAt: item.createdAt.toISOString(),
        createdBy: {
            id: item.createdBy.id,
            account: item.createdBy.email,
            nickname: item.createdBy.nickname,
        },
        usedCount,
        unusedCount: item.count - usedCount,
    };
}

export function serializeInviteCodeUsage(item: {
    id: string;
    code: string;
    batchId: string;
    usedAt: Date | null;
    batch: {
        createdAt: Date;
        remark: string;
    };
    usedBy: {
        id: string;
        email: string;
        nickname: string;
        groupName: string;
    } | null;
}) {
    return {
        inviteCodeId: item.id,
        code: item.code,
        batchId: item.batchId,
        batchCreatedAt: item.batch.createdAt.toISOString(),
        batchRemark: item.batch.remark,
        usedAt: item.usedAt ? item.usedAt.toISOString() : null,
        canRevoke: Boolean(item.usedBy),
        usedBy: item.usedBy ? {
            id: item.usedBy.id,
            account: item.usedBy.email,
            nickname: item.usedBy.nickname,
            groupName: item.usedBy.groupName,
        } : null,
    };
}
