export interface ChatStreamSource {
    title: string;
    url: string;
}

export type ChatStreamProjection =
    | {
        channel: 'messages';
        kind: 'delta' | 'done';
        content?: string;
        messageId?: string;
        runId?: string;
        seq?: number;
    }
    | {
        channel: 'sources';
        sources: ChatStreamSource[];
        runId?: string;
        seq?: number;
    }
    | {
        channel: 'suggestions';
        suggestions: string[];
        runId?: string;
        seq?: number;
    }
    | {
        channel: 'status';
        status: string;
        runId?: string;
        seq?: number;
    }
    | {
        channel: 'image_job';
        jobId: string;
        status?: string;
        message?: string;
        runId?: string;
        seq?: number;
    }
    | {
        channel: 'image';
        image: unknown;
        runId?: string;
        seq?: number;
    }
    | {
        channel: 'error';
        error: string;
        runId?: string;
        seq?: number;
    }
    | {
        channel: 'done';
        runId?: string;
        seq?: number;
    };

function readObject(input: unknown): Record<string, unknown> | null {
    return typeof input === 'object' && input !== null ? input as Record<string, unknown> : null;
}

function readString(input: unknown): string | undefined {
    return typeof input === 'string' ? input : undefined;
}

function readNumber(input: unknown): number | undefined {
    return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
}

function readRunId(input: Record<string, unknown>): string | undefined {
    const directRunId = readString(input.runId);
    if (directRunId) return directRunId;

    const params = readObject(input.params);
    return params ? readString(params.runId) : undefined;
}

function readSeq(input: Record<string, unknown>): number | undefined {
    const directSeq = readNumber(input.seq);
    if (directSeq !== undefined) return directSeq;

    const params = readObject(input.params);
    return params ? readNumber(params.seq) : undefined;
}

function withStreamMeta<T extends Record<string, unknown>>(projection: T, input: Record<string, unknown>): T {
    const runId = readRunId(input);
    const seq = readSeq(input);
    const writableProjection = projection as Record<string, unknown>;

    if (runId) {
        writableProjection.runId = runId;
    }
    if (seq !== undefined) {
        writableProjection.seq = seq;
    }

    return projection;
}

function addMessageId<T extends Record<string, unknown>>(projection: T, messageId: unknown): T {
    const normalizedMessageId = readString(messageId);
    if (normalizedMessageId) {
        (projection as Record<string, unknown>).messageId = normalizedMessageId;
    }
    return projection;
}

function normalizeSources(input: unknown): ChatStreamSource[] {
    if (!Array.isArray(input)) {
        return [];
    }

    return input
        .map((item): ChatStreamSource | null => {
            const source = readObject(item);
            if (!source) {
                return null;
            }

            const url = readString(source.url)?.trim();
            if (!url) {
                return null;
            }

            const title = readString(source.title)?.trim() || url;
            return { title, url };
        })
        .filter((item): item is ChatStreamSource => item !== null);
}

function normalizeSuggestions(input: unknown): string[] {
    if (!Array.isArray(input)) {
        return [];
    }

    return input
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeLangGraphMessageEvent(input: Record<string, unknown>): ChatStreamProjection | null {
    if (input.method !== 'messages') {
        return null;
    }

    const params = readObject(input.params);
    const data = readObject(params?.data);
    if (!data) {
        return null;
    }

    if (data.event === 'message-finish') {
        return withStreamMeta(addMessageId({
            channel: 'messages',
            kind: 'done',
        }, data.message_id || data.messageId), input) as ChatStreamProjection;
    }

    if (data.event !== 'content-block-delta') {
        return null;
    }

    const delta = readObject(data.delta);
    const text = readString(delta?.text) || readString(delta?.content) || readString(delta?.reasoning);
    if (!text) {
        return null;
    }

    return withStreamMeta(addMessageId({
        channel: 'messages',
        kind: 'delta',
        content: text,
    }, data.message_id || data.messageId), input) as ChatStreamProjection;
}

export function parseChatStreamSseLine(line: string): unknown | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) {
        return null;
    }

    const rawData = trimmed.slice('data:'.length).trim();
    if (!rawData || rawData === '[DONE]') {
        return { type: 'done' };
    }

    return JSON.parse(rawData);
}

export function normalizeChatStreamEvent(input: unknown): ChatStreamProjection | null {
    const event = readObject(input);
    if (!event) {
        return null;
    }

    const langGraphMessage = normalizeLangGraphMessageEvent(event);
    if (langGraphMessage) {
        return langGraphMessage;
    }

    const type = readString(event.type) || readString(event.method);
    const content = 'content' in event ? event.content : event.data;

    if (type === 'text' || type === 'message_delta' || type === 'message-delta') {
        const text = readString(content) || readString(event.delta);
        return text
            ? withStreamMeta(addMessageId({ channel: 'messages', kind: 'delta', content: text }, event.messageId), event) as ChatStreamProjection
            : null;
    }

    if (type === 'message_done' || type === 'message-done') {
        return withStreamMeta(addMessageId({ channel: 'messages', kind: 'done' }, event.messageId), event) as ChatStreamProjection;
    }

    if (type === 'sources') {
        return withStreamMeta({ channel: 'sources', sources: normalizeSources(content) }, event) as ChatStreamProjection;
    }

    if (type === 'suggestions') {
        return withStreamMeta({ channel: 'suggestions', suggestions: normalizeSuggestions(content) }, event) as ChatStreamProjection;
    }

    if (type === 'status') {
        const status = readString(content) || readString(event.status);
        return status ? withStreamMeta({ channel: 'status', status }, event) as ChatStreamProjection : null;
    }

    if (type === 'image_job') {
        const payload = readObject(content);
        const jobId = readString(payload?.jobId);
        if (!jobId) {
            return null;
        }
        const projection: Record<string, unknown> = { channel: 'image_job', jobId };
        const status = readString(payload?.status);
        const message = readString(payload?.message);
        if (status) projection.status = status;
        if (message) projection.message = message;
        return withStreamMeta(projection, event) as ChatStreamProjection;
    }

    if (type === 'image') {
        return withStreamMeta({ channel: 'image', image: content }, event) as ChatStreamProjection;
    }

    if (type === 'error') {
        return withStreamMeta({
            channel: 'error',
            error: readString(content) || readString(event.error) || readString(event.message) || 'AI 回复失败',
        }, event) as ChatStreamProjection;
    }

    if (type === 'done') {
        return withStreamMeta({ channel: 'done' }, event) as ChatStreamProjection;
    }

    return null;
}
