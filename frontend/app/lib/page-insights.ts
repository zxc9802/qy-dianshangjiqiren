import type { PageInsightRecord } from './extension-types';

type RawInsightRecord = {
    id: string;
    sourceUrl: string;
    sourceTitle: string;
    sourceDomain: string;
    summary: string | null;
    botId: string;
    botKind: string;
    botName: string;
    createdAt: Date;
    updatedAt: Date;
    pageContextJson: unknown;
    chatTranscriptJson: unknown;
};

export function normalizePageInsightRecord(record: RawInsightRecord): PageInsightRecord {
    return {
        id: record.id,
        sourceUrl: record.sourceUrl,
        sourceTitle: record.sourceTitle,
        sourceDomain: record.sourceDomain,
        summary: record.summary,
        botId: record.botId,
        botKind: record.botKind === 'custom' ? 'custom' : 'builtin',
        botName: record.botName,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        pageContext: record.pageContextJson as PageInsightRecord['pageContext'],
        chatTranscript: Array.isArray(record.chatTranscriptJson)
            ? record.chatTranscriptJson as PageInsightRecord['chatTranscript']
            : [],
    };
}
