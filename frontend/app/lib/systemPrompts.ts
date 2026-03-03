import fs from 'node:fs';
import path from 'node:path';

const PROMPT_DOC_NAMES = ['system_prompts.md', 'system_prompts_part2.md'];

let cachedPrompts: Record<string, string> | null = null;

function resolvePromptDocPath(fileName: string): string | null {
    const candidates = [
        path.resolve(process.cwd(), fileName),
        path.resolve(process.cwd(), '..', fileName),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function parsePrompts(markdown: string): Record<string, string> {
    const result: Record<string, string> = {};
    const regex = /##\s*(\d+)\.\s*[^\n]+\n[\s\S]*?```([\s\S]*?)```/g;
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(markdown)) !== null) {
        const id = match[1];
        const prompt = match[2]?.replace(/\r\n/g, '\n').trim();
        if (id && prompt) result[id] = prompt;
    }
    return result;
}

function loadAllPrompts(): Record<string, string> {
    if (cachedPrompts) return cachedPrompts;
    const merged: Record<string, string> = {};
    for (const fileName of PROMPT_DOC_NAMES) {
        const fullPath = resolvePromptDocPath(fileName);
        if (!fullPath) continue;
        try {
            const content = fs.readFileSync(fullPath, 'utf8');
            Object.assign(merged, parsePrompts(content));
        } catch (error) {
            console.error(`Failed to load prompt doc: ${fullPath}`, error);
        }
    }
    cachedPrompts = merged;
    return merged;
}

export function getSystemPromptBySortOrder(sortOrder: number, fallback: string): string {
    const prompts = loadAllPrompts();
    return prompts[String(sortOrder)] || fallback;
}

export function isPlaceholderPrompt(prompt: string): boolean {
    return prompt.includes('[系统提示词见 system_prompts.md');
}
