export type ExtractedMemory = {
    content: string;
    memoryType: string;
    importance: number;
};

export function resolveMemoryBotRouteId(
    memory: Pick<ExtractedMemory, 'memoryType'>,
    botRouteId: string,
): string | null {
    void memory;
    void botRouteId;
    return null;
}

const MAX_MEMORY_CONTENT_LENGTH = 500;
const SENSITIVE_PATTERNS = [
    /\b1[3-9]\d{9}\b/,
    /password|密码|口令|token|api[_-]?key|secret/i,
    /客户名单|身份证|银行卡|订单号/,
];

function clampImportance(value: unknown): number {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        return 1;
    }
    return Math.max(1, Math.min(5, Math.round(numberValue)));
}

export function isSafeMemoryContent(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > MAX_MEMORY_CONTENT_LENGTH) {
        return false;
    }

    return !SENSITIVE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function parseExtractedMemories(rawText: string): ExtractedMemory[] {
    const jsonText = rawText
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    let payload: unknown;
    try {
        payload = JSON.parse(jsonText);
    } catch {
        return [];
    }

    const rawMemories = payload && typeof payload === 'object'
        ? (payload as { memories?: unknown }).memories
        : undefined;
    if (!Array.isArray(rawMemories)) {
        return [];
    }

    const seen = new Set<string>();
    const memories: ExtractedMemory[] = [];

    for (const item of rawMemories) {
        if (!item || typeof item !== 'object') {
            continue;
        }

        const record = item as { content?: unknown; type?: unknown; memoryType?: unknown; importance?: unknown };
        const content = typeof record.content === 'string' ? record.content.trim() : '';
        if (!isSafeMemoryContent(content) || seen.has(content)) {
            continue;
        }

        seen.add(content);
        memories.push({
            content,
            memoryType: typeof record.memoryType === 'string'
                ? record.memoryType.trim() || 'preference'
                : typeof record.type === 'string'
                    ? record.type.trim() || 'preference'
                    : 'preference',
            importance: clampImportance(record.importance),
        });
    }

    return memories.slice(0, 5);
}

export function buildMemoryContextBlock(
    memories: Array<{ content: string }>,
    maxResults = 5,
): string {
    const safeMemories = memories
        .map((memory) => memory.content.trim())
        .filter((content) => content.length > 0)
        .slice(0, Math.max(0, maxResults));

    if (safeMemories.length === 0) {
        return '';
    }

    return [
        '# 用户长期记忆',
        '以下内容来自用户历史偏好和长期上下文，仅作为辅助参考；如果与当前对话冲突，以当前用户输入为准。',
        '',
        ...safeMemories.map((content) => `- ${content}`),
    ].join('\n');
}
