import {
    decodeConversationMessage,
    encodeConversationImageMessage,
    parseConversationImageMessage,
    type ConversationMessageOutput,
} from './conversation-message-codec';
import { normalizeGeneratedImagePaths } from './generated-image-storage';

interface ConversationMessageInput {
    content: string;
    inputType?: string;
}

export async function normalizeConversationMessage<T extends ConversationMessageInput>(message: T): Promise<{
    decoded: T & ConversationMessageOutput;
    normalizedContent: string;
    mutated: boolean;
}> {
    const parsed = parseConversationImageMessage(message.content);
    if (!parsed) {
        return {
            decoded: decodeConversationMessage(message),
            normalizedContent: message.content,
            mutated: false,
        };
    }

    const normalized = await normalizeGeneratedImagePaths(parsed.imageUrls);
    if (!normalized.mutated) {
        return {
            decoded: decodeConversationMessage(message),
            normalizedContent: message.content,
            mutated: false,
        };
    }

    const normalizedContent = encodeConversationImageMessage({
        content: parsed.content,
        imageUrls: normalized.paths,
        imagePrompt: parsed.imagePrompt,
        aspectRatio: parsed.aspectRatio,
    });

    return {
        decoded: decodeConversationMessage({ ...message, content: normalizedContent }),
        normalizedContent,
        mutated: true,
    };
}
