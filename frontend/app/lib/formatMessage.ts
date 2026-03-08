function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function cleanResidualMarkdown(text: string): string {
    return text
        .replace(/\\([*_#`])/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[*#]+/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function formatInline(text: string): string {
    const source = text.replace(/\r/g, '');
    const pattern = /(\*\*|__)(.+?)\1/g;
    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(source)) !== null) {
        const before = cleanResidualMarkdown(escapeHtml(source.slice(lastIndex, match.index)));
        if (before) {
            result += before;
        }

        const strongText = cleanResidualMarkdown(escapeHtml(match[2] || ''));
        if (strongText) {
            result += `<strong>${strongText}</strong>`;
        }

        lastIndex = match.index + match[0].length;
    }

    const trailing = cleanResidualMarkdown(escapeHtml(source.slice(lastIndex)));
    if (trailing) {
        result += trailing;
    }

    return result;
}

export function formatMessage(text: string): string {
    const cleaned = text
        .replace(/```json\s*\{[\s\S]*?"suggestions"[\s\S]*?\}\s*```/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/```/g, '')
        .replace(/\r/g, '');

    const lines = cleaned.split('\n');
    const parts: string[] = [];
    let inTable = false;
    let pendingBreaks = 0;

    const flushBreaks = (maxBreaks = 2) => {
        const count = Math.min(pendingBreaks, maxBreaks);
        for (let index = 0; index < count; index += 1) {
            parts.push('<br>');
        }
        pendingBreaks = 0;
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        const isTableLine = line.startsWith('|') && line.includes('|');

        if (isTableLine) {
            const cells = line.split('|').filter((cell) => cell.trim()).map((cell) => formatInline(cell.trim()));
            if (cells.every((cell) => /^[-:]+$/.test(cell))) {
                continue;
            }

            if (!inTable) {
                flushBreaks(1);
                parts.push('<table>');
                inTable = true;
            }

            parts.push(`<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`);
            continue;
        }

        if (inTable) {
            parts.push('</table>');
            inTable = false;
            pendingBreaks = Math.max(pendingBreaks, 1);
        }

        if (!line || /^---+$/.test(line)) {
            pendingBreaks = Math.min(pendingBreaks + 1, 2);
            continue;
        }

        const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
        if (headingMatch) {
            flushBreaks(2);
            const content = formatInline(headingMatch[1]);
            if (content) {
                parts.push(`<strong>${content}</strong>`);
                pendingBreaks = 1;
            }
            continue;
        }

        const unorderedMatch = line.match(/^[-*+•]\s+(.+)$/);
        if (unorderedMatch) {
            flushBreaks(2);
            const content = formatInline(unorderedMatch[1]);
            if (content) {
                parts.push(`• ${content}`);
                pendingBreaks = 1;
            }
            continue;
        }

        const orderedMatch = line.match(/^(\d+[\.\)\u3001])\s+(.+)$/);
        if (orderedMatch) {
            flushBreaks(2);
            const content = formatInline(orderedMatch[2]);
            if (content) {
                parts.push(`${orderedMatch[1]} ${content}`);
                pendingBreaks = 1;
            }
            continue;
        }

        const content = formatInline(line);
        if (!content) {
            pendingBreaks = Math.min(pendingBreaks + 1, 2);
            continue;
        }

        flushBreaks(2);
        parts.push(content);
        pendingBreaks = 1;
    }

    if (inTable) {
        parts.push('</table>');
    }

    return parts.join('')
        .replace(/^(<br>\s*)+/, '')
        .replace(/(<br>\s*)+$/, '');
}

export function extractSuggestions(text: string): string[] {
    const match = text.match(/```json\s*(\{[\s\S]*?"suggestions"[\s\S]*?\})\s*```/);
    if (!match) return [];
    try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed.suggestions)) {
            return parsed.suggestions;
        }
    } catch {
        return [];
    }
    return [];
}
