export type ConversationMessageKind = 'text' | 'image';

export interface ConversationImageMessagePayload {
    kind: 'image';
    content: string;
    imageUrls: string[];
    imagePrompt?: string;
    aspectRatio?: string;
}

interface ConversationMessageInput {
    content: string;
    inputType?: string;
}

export interface ConversationMessageOutput extends ConversationMessageInput {
    kind: ConversationMessageKind;
    imageUrls?: string[];
    imagePrompt?: string;
    aspectRatio?: string;
}

const IMAGE_MESSAGE_PREFIX = '__ECOM_CHAT_IMAGE__::';

export function buildConversationImageSummary(imageCount: number): string {
    return imageCount > 0 ? `已生成 ${imageCount} 张图片。` : '已生成图片。';
}

export function encodeConversationImageMessage(payload: {
    content?: string;
    imageUrls: string[];
    imagePrompt?: string;
    aspectRatio?: string;
}): string {
    const normalizedUrls = payload.imageUrls.filter(Boolean);
    const encodedPayload: ConversationImageMessagePayload = {
        kind: 'image',
        content: payload.content || buildConversationImageSummary(normalizedUrls.length),
        imageUrls: normalizedUrls,
        imagePrompt: payload.imagePrompt,
        aspectRatio: payload.aspectRatio,
    };

    return `${IMAGE_MESSAGE_PREFIX}${JSON.stringify(encodedPayload)}`;
}

export function parseConversationImageMessage(content: string): ConversationImageMessagePayload | null {
    if (!content.startsWith(IMAGE_MESSAGE_PREFIX)) {
        return null;
    }

    try {
        const parsed = JSON.parse(content.slice(IMAGE_MESSAGE_PREFIX.length)) as Partial<ConversationImageMessagePayload>;
        const imageUrls = Array.isArray(parsed.imageUrls) ? parsed.imageUrls.filter((url): url is string => typeof url === 'string' && url.length > 0) : [];
        return {
            kind: 'image',
            content: typeof parsed.content === 'string' && parsed.content.trim()
                ? parsed.content
                : buildConversationImageSummary(imageUrls.length),
            imageUrls,
            imagePrompt: typeof parsed.imagePrompt === 'string' ? parsed.imagePrompt : undefined,
            aspectRatio: typeof parsed.aspectRatio === 'string' ? parsed.aspectRatio : undefined,
        };
    } catch {
        return null;
    }
}

export function decodeConversationMessage<T extends ConversationMessageInput>(message: T): T & ConversationMessageOutput {
    const parsed = parseConversationImageMessage(message.content);
    if (parsed) {
        return {
            ...message,
            kind: 'image',
            content: parsed.content,
            imageUrls: parsed.imageUrls,
            imagePrompt: parsed.imagePrompt,
            aspectRatio: parsed.aspectRatio,
        };
    }

    return {
        ...message,
        kind: message.inputType === 'image' ? 'image' : 'text',
    };
}

export function isConversationImageTurn(message: ConversationMessageInput): boolean {
    return message.inputType === 'image' || message.content.startsWith(IMAGE_MESSAGE_PREFIX);
}
