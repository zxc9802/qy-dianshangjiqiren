const IMAGE_GENERATION_HISTORY_TURNS = 5;

export interface ImageGenerationContextMessage {
    role: string;
    content: string;
    imageUrls?: string[];
}

function takeRecentUserTurns<T extends { role: string }>(messages: T[], maxUserTurns: number): T[] {
    if (maxUserTurns <= 0) return [];

    let includedUserTurns = 0;
    let startIndex = messages.length;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        startIndex = index;
        if (messages[index].role === 'user') {
            includedUserTurns += 1;
            if (includedUserTurns >= maxUserTurns) break;
        }
    }

    return includedUserTurns < maxUserTurns ? messages : messages.slice(startIndex);
}

function roleLabel(role: string): string {
    return role === 'assistant' ? 'Assistant' : 'User';
}

export function buildImageGenerationPrompt({
    currentPrompt,
    historyMessages,
}: {
    currentPrompt: string;
    historyMessages: ImageGenerationContextMessage[];
}): string {
    const recentMessages = takeRecentUserTurns(
        historyMessages
            .map((message) => ({
                role: message.role,
                content: message.content.trim(),
            }))
            .filter((message) => message.content.length > 0),
        IMAGE_GENERATION_HISTORY_TURNS,
    );
    const trimmedCurrentPrompt = currentPrompt.trim();

    if (recentMessages.length === 0) {
        return trimmedCurrentPrompt;
    }

    const historyText = recentMessages
        .map((message) => `${roleLabel(message.role)}: ${message.content}`)
        .join('\n\n');

    return [
        'Use the recent conversation context to resolve references in the image request. Do not draw the conversation itself unless the user asks for chat UI.',
        `Recent conversation context:\n${historyText}`,
        `Current image request:\n${trimmedCurrentPrompt}`,
    ].join('\n\n');
}

function isImageModificationPrompt(prompt: string): boolean {
    return /(上一张|前一张|刚才|之前|这张|那张|原图|参考图|基于|按照|修改|改成|调整|换成|替换|保持)/.test(prompt)
        && /(图|图片|照片|海报|画面|背景|产品)/.test(prompt);
}

function requestedImageIndex(prompt: string): number | null {
    const numeric = prompt.match(/第\s*(\d{1,2})\s*(张|个|幅|图|图片)/);
    if (numeric) return Number(numeric[1]) - 1;

    const chineseNumbers: Record<string, number> = {
        一: 0,
        二: 1,
        两: 1,
        三: 2,
        四: 3,
    };
    const chinese = prompt.match(/第\s*([一二两三四])\s*(张|个|幅|图|图片)/);
    return chinese ? chineseNumbers[chinese[1]] : null;
}

export function selectImageReferenceForPrompt({
    currentPrompt,
    historyMessages,
}: {
    currentPrompt: string;
    historyMessages: ImageGenerationContextMessage[];
}): { url: string } | null {
    const prompt = currentPrompt.trim();
    if (!isImageModificationPrompt(prompt)) return null;

    const recentMessages = takeRecentUserTurns(historyMessages, IMAGE_GENERATION_HISTORY_TURNS);
    const imageBatches = recentMessages
        .map((message) => (Array.isArray(message.imageUrls) ? message.imageUrls.filter(Boolean) : []))
        .filter((urls) => urls.length > 0);
    if (imageBatches.length === 0) return null;

    const latestBatch = imageBatches[imageBatches.length - 1];
    const requestedIndex = requestedImageIndex(prompt);
    if (requestedIndex !== null && latestBatch[requestedIndex]) {
        return { url: latestBatch[requestedIndex] };
    }

    return { url: latestBatch[latestBatch.length - 1] };
}
