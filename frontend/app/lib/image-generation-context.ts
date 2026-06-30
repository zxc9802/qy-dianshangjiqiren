const IMAGE_GENERATION_HISTORY_TURNS = 5;
const IMAGE_PROMPT_COMPILER_CONTEXT_MAX_LENGTH = 6000;
export const IMAGE_GENERATION_PROMPT_MAX_LENGTH = 1800;

export interface ImageGenerationContextMessage {
    role: string;
    content: string;
    imageUrls?: string[];
}

export interface ImagePromptCompilerBrief {
    subject?: string;
    mustKeepDetails?: string[];
    visualStyle?: string[];
    layout?: string[];
    textToRender?: string[];
    colors?: string[];
    negativeConstraints?: string[];
    referenceImageNeeded?: boolean;
    imagePrompt?: string;
}

export const IMAGE_PROMPT_COMPILER_SYSTEM_PROMPT = `You compile chat context into a concise image-generation brief.
Return JSON only. Do not include markdown.
Schema:
{
  "subject": "what image to create",
  "mustKeepDetails": ["facts, numbers, product names, aspect ratio, required details"],
  "visualStyle": ["visual style words"],
  "layout": ["composition and layout requirements"],
  "textToRender": ["exact visible text that should appear in the image"],
  "colors": ["color requirements"],
  "negativeConstraints": ["things to avoid"],
  "referenceImageNeeded": false,
  "imagePrompt": "final concise prompt for the image model"
}
Rules:
- Preserve the current user request exactly in meaning.
- Keep concrete numbers, aspect ratios, title text, brand/product names, and negative constraints.
- Remove unrelated conversation, long explanations, and chit-chat.
- If the user refers to an existing image ("上图", "以上图片", "上一张图", "参考图", "this image"), set referenceImageNeeded to true.
- Keep imagePrompt concise and under 900 Chinese characters.`;

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

function truncateText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    if (maxLength <= 1) return normalized.slice(0, maxLength);
    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function joinWithinBudget(parts: string[], maxLength: number): string {
    const kept: string[] = [];
    for (const part of parts.map((item) => item.trim()).filter(Boolean)) {
        const prefixLength = kept.length > 0 ? 2 : 0;
        const currentLength = kept.join('\n\n').length;
        const remaining = maxLength - currentLength - prefixLength;
        if (remaining <= 0) break;
        if (part.length <= remaining) {
            kept.push(part);
            continue;
        }
        kept.push(truncateText(part, remaining));
        break;
    }
    return kept.join('\n\n');
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12);
}

function formatList(label: string, values?: string[]): string {
    if (!values?.length) return '';
    return `${label}: ${values.join('; ')}`;
}

function buildPromptFromCompiledBrief(currentPrompt: string, compiledBrief: ImagePromptCompilerBrief): string {
    const parts = [
        `Current user request: ${currentPrompt}`,
        compiledBrief.imagePrompt ? `Compiled image prompt: ${compiledBrief.imagePrompt}` : '',
        compiledBrief.subject ? `Subject: ${compiledBrief.subject}` : '',
        formatList('Must keep details', compiledBrief.mustKeepDetails),
        formatList('Visible text to render', compiledBrief.textToRender),
        formatList('Visual style', compiledBrief.visualStyle),
        formatList('Layout', compiledBrief.layout),
        formatList('Colors', compiledBrief.colors),
        formatList('Negative constraints', compiledBrief.negativeConstraints),
        compiledBrief.referenceImageNeeded ? 'Use the selected reference image when available.' : '',
    ];

    return joinWithinBudget(parts, IMAGE_GENERATION_PROMPT_MAX_LENGTH);
}

export function buildImageGenerationPrompt({
    currentPrompt,
    historyMessages,
    compiledBrief,
}: {
    currentPrompt: string;
    historyMessages: ImageGenerationContextMessage[];
    compiledBrief?: ImagePromptCompilerBrief | null;
}): string {
    const trimmedCurrentPrompt = currentPrompt.trim();
    if (compiledBrief) {
        return buildPromptFromCompiledBrief(trimmedCurrentPrompt, compiledBrief);
    }

    const recentMessages = takeRecentUserTurns(
        historyMessages
            .map((message) => ({
                role: message.role,
                content: message.content.trim(),
            }))
            .filter((message) => message.content.length > 0),
        IMAGE_GENERATION_HISTORY_TURNS,
    );

    if (recentMessages.length === 0) {
        return joinWithinBudget([trimmedCurrentPrompt], IMAGE_GENERATION_PROMPT_MAX_LENGTH);
    }

    const historyText = recentMessages
        .map((message) => `${roleLabel(message.role)}: ${message.content}`)
        .join('\n\n');

    return joinWithinBudget([
        'Use the recent conversation context to resolve references in the image request. Do not draw the conversation itself unless the user asks for chat UI.',
        `Current image request:\n${trimmedCurrentPrompt}`,
        `Recent conversation context:\n${historyText}`,
    ], IMAGE_GENERATION_PROMPT_MAX_LENGTH);
}

export function buildImagePromptCompilerUserMessage({
    currentPrompt,
    historyMessages,
}: {
    currentPrompt: string;
    historyMessages: ImageGenerationContextMessage[];
}): string {
    const recentMessages = takeRecentUserTurns(historyMessages, IMAGE_GENERATION_HISTORY_TURNS);
    const historyParts = recentMessages.map((message, index) => {
        const content = truncateText(message.content || '', 900);
        const imageUrls = Array.isArray(message.imageUrls) && message.imageUrls.length
            ? `\nGenerated image URLs: ${message.imageUrls.filter(Boolean).join(', ')}`
            : '';
        return `Message ${index + 1} (${roleLabel(message.role)}): ${content}${imageUrls}`;
    });

    return joinWithinBudget([
        `Current user image request:\n${currentPrompt.trim()}`,
        historyParts.length ? `Recent candidate context:\n${historyParts.join('\n\n')}` : '',
    ], IMAGE_PROMPT_COMPILER_CONTEXT_MAX_LENGTH);
}

function extractJsonObjectText(value: string): string | null {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();

    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    return value.slice(start, end + 1);
}

export function parseImagePromptCompilerOutput(value: string): ImagePromptCompilerBrief | null {
    const jsonText = extractJsonObjectText(value);
    if (!jsonText) return null;

    try {
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object') return null;
        return {
            subject: typeof parsed.subject === 'string' ? parsed.subject.trim() : undefined,
            mustKeepDetails: normalizeStringArray(parsed.mustKeepDetails),
            visualStyle: normalizeStringArray(parsed.visualStyle),
            layout: normalizeStringArray(parsed.layout),
            textToRender: normalizeStringArray(parsed.textToRender),
            colors: normalizeStringArray(parsed.colors),
            negativeConstraints: normalizeStringArray(parsed.negativeConstraints),
            referenceImageNeeded: parsed.referenceImageNeeded === true,
            imagePrompt: typeof parsed.imagePrompt === 'string' ? parsed.imagePrompt.trim() : undefined,
        };
    } catch {
        return null;
    }
}

function isImageModificationPrompt(prompt: string): boolean {
    return /(上一张|前一张|刚才|刚刚|之前|这张|那张|上图|以上图片|上面的图|上面的图片|前面的图|前面的图片|原图|参考图|基于|按照|修改|改成|调整|换成|替换|保持)/.test(prompt)
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
    compiledBrief,
}: {
    currentPrompt: string;
    historyMessages: ImageGenerationContextMessage[];
    compiledBrief?: Pick<ImagePromptCompilerBrief, 'referenceImageNeeded'> | null;
}): { url: string } | null {
    const prompt = currentPrompt.trim();
    if (!isImageModificationPrompt(prompt) && compiledBrief?.referenceImageNeeded !== true) return null;

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
