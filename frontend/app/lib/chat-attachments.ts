export type ChatAttachmentKind = 'document' | 'image' | 'video';

export interface ChatAttachmentFrame {
    url: string;
    timestampMs: number;
}

export interface ChatAttachmentUpload {
    kind: ChatAttachmentKind;
    fileName: string;
    fileSize: number;
    mimeType?: string;
    extractedText: string;
    previewUrl?: string;
    durationMs?: number;
    transcript?: string;
    frames?: ChatAttachmentFrame[];
    tempVideoToken?: string;
}

export interface StoredChatAttachmentMetadata {
    version: 1;
    kind: ChatAttachmentKind;
    mimeType?: string;
    extractedText: string;
    durationMs?: number;
    transcript?: string;
    frames?: ChatAttachmentFrame[];
}

export interface ChatAttachmentRecord extends ChatAttachmentUpload {
    fileUrl: string;
}

const ATTACHMENT_METADATA_VERSION = 1;

function normalizeFrame(frame: unknown): ChatAttachmentFrame | null {
    if (typeof frame !== 'object' || frame === null) {
        return null;
    }

    const record = frame as { url?: unknown; timestampMs?: unknown };
    if (typeof record.url !== 'string' || !record.url) {
        return null;
    }

    return {
        url: record.url,
        timestampMs: typeof record.timestampMs === 'number' && Number.isFinite(record.timestampMs)
            ? Math.max(0, Math.round(record.timestampMs))
            : 0,
    };
}

export function buildAttachmentDisplayLabel(attachment: Pick<ChatAttachmentUpload, 'kind' | 'fileName'>): string {
    if (attachment.kind === 'video') {
        return `[视频: ${attachment.fileName}]`;
    }
    if (attachment.kind === 'image') {
        return `[图片: ${attachment.fileName}]`;
    }
    return `[文件: ${attachment.fileName}]`;
}

export function buildMessageDisplayContent(text: string, attachments: Array<Pick<ChatAttachmentUpload, 'kind' | 'fileName'>>): string {
    const trimmed = text.trim();
    const labels = attachments.map(buildAttachmentDisplayLabel).join('\n');

    if (labels && trimmed) {
        return `${labels}\n${trimmed}`;
    }

    return labels || trimmed;
}

export function stripAttachmentDisplayLabels(text: string, attachments: Array<Pick<ChatAttachmentUpload, 'kind' | 'fileName'>>): string {
    const lines = text.split(/\r?\n/);
    const remainingLabels = new Set(attachments.map(buildAttachmentDisplayLabel));
    let index = 0;

    while (index < lines.length && remainingLabels.has(lines[index])) {
        remainingLabels.delete(lines[index]);
        index += 1;
    }

    return lines.slice(index).join('\n').trim();
}

export function getDefaultAttachmentPrompt(attachments: Array<Pick<ChatAttachmentUpload, 'kind'>>): string {
    if (attachments.some((attachment) => attachment.kind === 'video')) {
        return '请分析我上传的视频，提取关键信息并给出结构化结论。';
    }
    if (attachments.some((attachment) => attachment.kind === 'image')) {
        return '请分析我上传的图片内容并给出结论。';
    }
    return '请阅读我上传的文件并提取关键信息。';
}

export function buildAttachmentContextBlock(attachment: Pick<
ChatAttachmentUpload,
'kind' | 'fileName' | 'extractedText' | 'durationMs' | 'transcript' | 'frames'
>): string {
    const title = attachment.kind === 'video'
        ? `视频附件：${attachment.fileName}`
        : attachment.kind === 'image'
            ? `图片附件：${attachment.fileName}`
            : `文件附件：${attachment.fileName}`;

    const sections: string[] = [title];

    if (attachment.kind === 'video' && typeof attachment.durationMs === 'number' && attachment.durationMs > 0) {
        sections.push(`时长：${formatDuration(attachment.durationMs)}`);
    }

    if (attachment.kind === 'video' && attachment.transcript?.trim()) {
        sections.push(`语音转写：\n${attachment.transcript.trim()}`);
    }

    if (attachment.kind === 'video' && attachment.frames?.length) {
        sections.push(`关键帧数量：${attachment.frames.length}`);
    }

    const extractedText = attachment.extractedText.trim();
    if (extractedText) {
        sections.push(`解析内容：\n${extractedText}`);
    }

    return sections.join('\n\n');
}

export function buildMessagePromptText(text: string, attachments: ChatAttachmentUpload[]): string {
    const userPrompt = text.trim() || getDefaultAttachmentPrompt(attachments);
    const attachmentBlocks = attachments
        .map((attachment) => buildAttachmentContextBlock(attachment))
        .filter(Boolean);

    if (attachmentBlocks.length === 0) {
        return userPrompt;
    }

    return [
        `用户问题：\n${userPrompt}`,
        `附件上下文：\n\n${attachmentBlocks.join('\n\n---\n\n')}`,
    ].join('\n\n');
}

export function serializeAttachmentMetadata(attachment: ChatAttachmentUpload): string {
    const payload: StoredChatAttachmentMetadata = {
        version: ATTACHMENT_METADATA_VERSION,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        extractedText: attachment.extractedText,
        durationMs: attachment.durationMs,
        transcript: attachment.transcript,
        frames: (attachment.frames || []).map((frame) => ({
            url: frame.url,
            timestampMs: Math.max(0, Math.round(frame.timestampMs)),
        })),
    };

    return JSON.stringify(payload);
}

export function parseAttachmentMetadata(
    parsedText: string | null | undefined,
    fileType: string,
    fileUrl = '',
): StoredChatAttachmentMetadata | null {
    if (!parsedText) {
        return null;
    }

    try {
        const parsed = JSON.parse(parsedText) as Partial<StoredChatAttachmentMetadata>;
        if (parsed.version !== ATTACHMENT_METADATA_VERSION || typeof parsed.kind !== 'string') {
            return null;
        }

        return {
            version: ATTACHMENT_METADATA_VERSION,
            kind: parsed.kind as ChatAttachmentKind,
            mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : undefined,
            extractedText: typeof parsed.extractedText === 'string' ? parsed.extractedText : '',
            durationMs: typeof parsed.durationMs === 'number' && Number.isFinite(parsed.durationMs)
                ? Math.max(0, Math.round(parsed.durationMs))
                : undefined,
            transcript: typeof parsed.transcript === 'string' ? parsed.transcript : undefined,
            frames: Array.isArray(parsed.frames)
                ? parsed.frames.map(normalizeFrame).filter((frame): frame is ChatAttachmentFrame => frame !== null)
                : [],
        };
    } catch {
        const inferredKind: ChatAttachmentKind = fileType.startsWith('image/')
            ? 'image'
            : fileType.startsWith('video/')
                ? 'video'
                : 'document';

        return {
            version: ATTACHMENT_METADATA_VERSION,
            kind: inferredKind,
            mimeType: fileType || undefined,
            extractedText: parsedText,
            frames: fileUrl && inferredKind === 'video' ? [{ url: fileUrl, timestampMs: 0 }] : [],
        };
    }
}

export function normalizeAttachmentRecord(input: {
    fileName: string;
    fileSize: number;
    fileType: string;
    fileUrl: string;
    parsedText?: string | null;
}): ChatAttachmentRecord {
    const metadata = parseAttachmentMetadata(input.parsedText, input.fileType, input.fileUrl);
    const frames = metadata?.frames || [];
    const previewUrl = input.fileUrl || frames[0]?.url || undefined;

    return {
        kind: metadata?.kind || (input.fileType.startsWith('video/') ? 'video' : input.fileType.startsWith('image/') ? 'image' : 'document'),
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: metadata?.mimeType || input.fileType || undefined,
        extractedText: metadata?.extractedText || '',
        previewUrl,
        durationMs: metadata?.durationMs,
        transcript: metadata?.transcript,
        frames,
        fileUrl: input.fileUrl,
    };
}

export function hasVideoAttachments(attachments: Array<Pick<ChatAttachmentUpload, 'kind'>>): boolean {
    return attachments.some((attachment) => attachment.kind === 'video');
}

export function formatDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
