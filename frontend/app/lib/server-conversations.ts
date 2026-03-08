import { Prisma } from '@prisma/client';
import { AppError } from './auth';
import { prisma } from './prisma';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOM_BOT_CATEGORY = 'My Bot';

export type ConversationBotKind = 'builtin' | 'custom';

export interface ConversationBotPayload {
    routeId: string;
    kind: ConversationBotKind;
    refId: string;
    name: string;
    icon: string;
    category: string;
    pointsPerUse: number;
    isActive: boolean;
}

type ConversationRecord = {
    botId: string | null;
    customBotId: string | null;
    botKindSnapshot: string;
    botRouteIdSnapshot: string;
    botRefIdSnapshot: string;
    botNameSnapshot: string;
    botIconSnapshot: string;
    botCategorySnapshot: string;
    pointsPerUseSnapshot: number;
    bot?: {
        id: string;
        name: string;
        icon: string;
        category: string;
        pointsPerUse: number;
        sortOrder?: number;
        isActive?: boolean;
    } | null;
    customBot?: {
        id: string;
        name: string;
        avatar: string;
        icon: string;
        pointsPerUse: number;
        isActive: boolean;
    } | null;
};

export interface ResolvedConversationBotTarget {
    kind: ConversationBotKind;
    routeId: string;
    refId: string;
    name: string;
    icon: string;
    category: string;
    pointsPerUse: number;
    botId: string | null;
    customBotId: string | null;
    isActive: boolean;
}

function buildBuiltinTarget(bot: {
    id: string;
    name: string;
    icon: string;
    category: string;
    pointsPerUse: number;
    sortOrder: number;
    isActive?: boolean;
}): ResolvedConversationBotTarget {
    return {
        kind: 'builtin',
        routeId: String(bot.sortOrder),
        refId: bot.id,
        name: bot.name,
        icon: bot.icon || '',
        category: bot.category || '',
        pointsPerUse: bot.pointsPerUse,
        botId: bot.id,
        customBotId: null,
        isActive: bot.isActive ?? true,
    };
}

function buildCustomTarget(customBot: {
    id: string;
    name: string;
    avatar: string;
    icon: string;
    pointsPerUse: number;
    isActive: boolean;
}): ResolvedConversationBotTarget {
    return {
        kind: 'custom',
        routeId: `custom-${customBot.id}`,
        refId: customBot.id,
        name: customBot.name,
        icon: customBot.avatar || customBot.icon || '',
        category: CUSTOM_BOT_CATEGORY,
        pointsPerUse: customBot.pointsPerUse,
        botId: null,
        customBotId: customBot.id,
        isActive: customBot.isActive,
    };
}

export function getConversationBotPayload(record: ConversationRecord): ConversationBotPayload {
    if (record.bot) {
        const target = buildBuiltinTarget({
            ...record.bot,
            sortOrder: record.bot.sortOrder ?? Number(record.botRouteIdSnapshot || 0),
        });
        return {
            routeId: target.routeId,
            kind: target.kind,
            refId: target.refId,
            name: target.name,
            icon: target.icon,
            category: target.category,
            pointsPerUse: target.pointsPerUse,
            isActive: target.isActive,
        };
    }

    if (record.customBot) {
        const target = buildCustomTarget(record.customBot);
        return {
            routeId: target.routeId,
            kind: target.kind,
            refId: target.refId,
            name: target.name,
            icon: target.icon,
            category: target.category,
            pointsPerUse: target.pointsPerUse,
            isActive: target.isActive,
        };
    }

    const kind: ConversationBotKind = record.botKindSnapshot === 'custom' ? 'custom' : 'builtin';
    const refId = record.botRefIdSnapshot || (kind === 'custom' && record.botRouteIdSnapshot.startsWith('custom-')
        ? record.botRouteIdSnapshot.slice('custom-'.length)
        : '');
    const routeId = record.botRouteIdSnapshot || (kind === 'custom' && refId ? `custom-${refId}` : refId);

    return {
        routeId,
        kind,
        refId,
        name: record.botNameSnapshot || 'Deleted bot',
        icon: record.botIconSnapshot || '',
        category: record.botCategorySnapshot || (kind === 'custom' ? CUSTOM_BOT_CATEGORY : ''),
        pointsPerUse: record.pointsPerUseSnapshot || 0,
        isActive: false,
    };
}

export async function resolveConversationBotTarget(userId: string, routeBotId: string): Promise<ResolvedConversationBotTarget> {
    const raw = String(routeBotId || '').trim();
    if (!raw) {
        throw new AppError('botId is required');
    }

    if (raw.startsWith('custom-')) {
        const customId = raw.slice('custom-'.length);
        if (!UUID_RE.test(customId)) {
            throw new AppError('Invalid custom bot id');
        }

        const customBot = await prisma.customBot.findFirst({
            where: { id: customId, userId },
            select: {
                id: true,
                name: true,
                avatar: true,
                icon: true,
                pointsPerUse: true,
                isActive: true,
            },
        });

        if (!customBot || !customBot.isActive) {
            throw new AppError('Custom bot not found', 404);
        }

        return buildCustomTarget(customBot);
    }

    let builtinBot: {
        id: string;
        name: string;
        icon: string;
        category: string;
        pointsPerUse: number;
        sortOrder: number;
        isActive: boolean;
    } | null = null;

    if (/^\d+$/.test(raw)) {
        builtinBot = await prisma.bot.findFirst({
            where: { sortOrder: Number(raw), isActive: true },
            select: {
                id: true,
                name: true,
                icon: true,
                category: true,
                pointsPerUse: true,
                sortOrder: true,
                isActive: true,
            },
        });
    } else if (UUID_RE.test(raw)) {
        builtinBot = await prisma.bot.findFirst({
            where: { id: raw, isActive: true },
            select: {
                id: true,
                name: true,
                icon: true,
                category: true,
                pointsPerUse: true,
                sortOrder: true,
                isActive: true,
            },
        });
    }

    if (!builtinBot) {
        throw new AppError('Bot not found', 404);
    }

    return buildBuiltinTarget(builtinBot);
}

export function createConversationSnapshotInput(target: ResolvedConversationBotTarget): Pick<
    Prisma.ConversationUncheckedCreateInput,
    | 'botId'
    | 'customBotId'
    | 'botKindSnapshot'
    | 'botRouteIdSnapshot'
    | 'botRefIdSnapshot'
    | 'botNameSnapshot'
    | 'botIconSnapshot'
    | 'botCategorySnapshot'
    | 'pointsPerUseSnapshot'
> {
    return {
        botId: target.botId,
        customBotId: target.customBotId,
        botKindSnapshot: target.kind,
        botRouteIdSnapshot: target.routeId,
        botRefIdSnapshot: target.refId,
        botNameSnapshot: target.name,
        botIconSnapshot: target.icon,
        botCategorySnapshot: target.category,
        pointsPerUseSnapshot: target.pointsPerUse,
    };
}

export function buildConversationTitle(botName: string, messages: Array<{ role: string; content: string }>): string {
    const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim());
    if (firstUserMessage) {
        return firstUserMessage.content.replace(/\s+/g, ' ').slice(0, 40);
    }

    return `与${botName || 'AI助手'}的对话`;
}
