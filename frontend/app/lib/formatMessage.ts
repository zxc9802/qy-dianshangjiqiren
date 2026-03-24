function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
    return escapeHtml(value)
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const SAFE_LINE_BREAK_PATTERN = /<br\s*\/?>/gi;
const SAFE_LINE_BREAK_TOKEN = '__SAFE_LINE_BREAK__';

export interface FormatMessageOptions {
    tableClassName?: string;
    enableTableCopyButton?: boolean;
    tableWrapperClassName?: string;
    tableCopyButtonClassName?: string;
    tableCopyButtonLabel?: string;
}

function escapeHtmlPreservingLineBreaks(value: string): string {
    return escapeHtml(value.replace(SAFE_LINE_BREAK_PATTERN, SAFE_LINE_BREAK_TOKEN))
        .replace(new RegExp(SAFE_LINE_BREAK_TOKEN, 'g'), '<br>');
}

function cleanResidualMarkdown(text: string): string {
    return text
        .replace(/\\([*_#`])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function formatInlineSegment(source: string): string {
    const pattern = /(`[^`]+`|(\*\*|__)(.+?)\2)/g;
    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(source)) !== null) {
        const before = cleanResidualMarkdown(escapeHtmlPreservingLineBreaks(source.slice(lastIndex, match.index)));
        if (before) {
            result += before;
        }

        const token = match[0] || '';
        if (token.startsWith('`')) {
            const codeText = escapeHtml(token.slice(1, -1));
            if (codeText) {
                result += `<code>${codeText}</code>`;
            }
        } else {
            const strongText = cleanResidualMarkdown(escapeHtmlPreservingLineBreaks(match[3] || ''));
            if (strongText) {
                result += `<strong>${strongText}</strong>`;
            }
        }

        lastIndex = match.index + token.length;
    }

    const trailing = cleanResidualMarkdown(escapeHtmlPreservingLineBreaks(source.slice(lastIndex)));
    if (trailing) {
        result += trailing;
    }

    return result;
}

function formatInline(text: string): string {
    return formatInlineSegment(text.replace(/\r/g, ''));
}

function buildTableOpenTag(tableClassName?: string): string {
    if (!tableClassName) {
        return '<table>';
    }

    return `<table class="${escapeAttribute(tableClassName)}">`;
}

function splitTableCells(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
}

function isTableSeparatorRow(cells: string[]): boolean {
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function buildClassAttribute(className?: string): string {
    return className ? ` class="${escapeAttribute(className)}"` : '';
}

function renderTableRows(rows: string[][], options: FormatMessageOptions): string {
    if (!rows.length) {
        return '';
    }

    let hasHeader = false;
    let bodyRows = rows;

    if (rows.length >= 2 && isTableSeparatorRow(rows[1])) {
        hasHeader = true;
        bodyRows = rows.slice(2);
    }

    const headerRow = hasHeader ? rows[0] : null;
    let tableHtml = buildTableOpenTag(options.tableClassName);

    if (headerRow) {
        tableHtml += `<thead><tr>${headerRow.map((cell) => `<th scope="col">${formatInline(cell)}</th>`).join('')}</tr></thead>`;
    }

    tableHtml += '<tbody>';

    const rowsToRender = hasHeader ? bodyRows : rows;
    rowsToRender.forEach((row) => {
        tableHtml += `<tr>${row.map((cell) => `<td>${formatInline(cell)}</td>`).join('')}</tr>`;
    });

    tableHtml += '</tbody></table>';

    if (!options.enableTableCopyButton) {
        return tableHtml;
    }

    const label = escapeHtml(options.tableCopyButtonLabel || '复制表格');
    return `<div${buildClassAttribute(options.tableWrapperClassName)} data-copy-table-wrapper="true">${tableHtml}<button type="button"${buildClassAttribute(options.tableCopyButtonClassName)} data-copy-table-button="true">${label}</button></div>`;
}

function formatCodeBlock(code: string): string {
    const escaped = escapeHtml(code.trimEnd());
    if (!escaped.trim()) {
        return '';
    }

    return `<pre><code>${escaped}</code></pre>`;
}

const COMPLETE_SUGGESTION_BLOCK_PATTERNS = [
    /(?:\n|^)\s*```json\s*(\{\s*"suggestions"\s*:\s*\[[\s\S]*?\]\s*\})\s*```\s*$/i,
    /(?:\n|^)\s*(\{\s*"suggestions"\s*:\s*\[[\s\S]*?\]\s*\})\s*$/i,
];

const PARTIAL_SUGGESTION_BLOCK_PATTERNS = [
    /(?:\n|^)\s*```json\s*\{\s*"suggestions"\s*:\s*\[[\s\S]*$/i,
    /(?:\n|^)\s*\{\s*"suggestions"\s*:\s*\[[\s\S]*$/i,
];

function findSuggestionBlock(text: string): RegExpMatchArray | null {
    for (const pattern of COMPLETE_SUGGESTION_BLOCK_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            return match;
        }
    }

    return null;
}

export function stripSuggestionBlock(text: string): string {
    let nextText = text.trimEnd();

    for (const pattern of PARTIAL_SUGGESTION_BLOCK_PATTERNS) {
        nextText = nextText.replace(pattern, '').trimEnd();
    }

    for (const pattern of COMPLETE_SUGGESTION_BLOCK_PATTERNS) {
        nextText = nextText.replace(pattern, '').trimEnd();
    }

    return nextText;
}

export function extractMarkdownTables(text: string): string[] {
    const cleaned = stripSuggestionBlock(text.replace(/\r/g, ''));
    const lines = cleaned.split('\n');
    const tables: string[] = [];
    let currentTable: string[] = [];
    let inCodeBlock = false;

    const flushTable = () => {
        if (!currentTable.length) {
            return;
        }

        tables.push(currentTable.join('\n').trim());
        currentTable = [];
    };

    for (const rawLine of lines) {
        const trimmedStart = rawLine.trimStart();

        if (trimmedStart.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            flushTable();
            continue;
        }

        if (inCodeBlock) {
            continue;
        }

        const line = rawLine.trim();
        const isTableLine = line.startsWith('|') && line.includes('|');

        if (isTableLine) {
            currentTable.push(line);
            continue;
        }

        flushTable();
    }

    flushTable();

    return tables;
}

export function formatMessage(text: string, options: FormatMessageOptions = {}): string {
    const cleaned = stripSuggestionBlock(text.replace(/\r/g, ''));
    const lines = cleaned.split('\n');
    const parts: string[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let inCodeBlock = false;
    let pendingBreaks = 0;
    let codeLines: string[] = [];

    const flushBreaks = (maxBreaks = 2) => {
        const count = Math.min(pendingBreaks, maxBreaks);
        for (let index = 0; index < count; index += 1) {
            parts.push('<br>');
        }
        pendingBreaks = 0;
    };

    const closeTable = () => {
        if (inTable) {
            const tableHtml = renderTableRows(tableRows, options);
            if (tableHtml) {
                parts.push(tableHtml);
            }
            inTable = false;
            tableRows = [];
            pendingBreaks = Math.max(pendingBreaks, 1);
        }
    };

    const closeCodeBlock = () => {
        if (!inCodeBlock) {
            return;
        }

        const html = formatCodeBlock(codeLines.join('\n'));
        if (html) {
            parts.push(html);
            pendingBreaks = 1;
        }
        inCodeBlock = false;
        codeLines = [];
    };

    for (const rawLine of lines) {
        const trimmedStart = rawLine.trimStart();

        if (trimmedStart.startsWith('```')) {
            closeTable();

            if (inCodeBlock) {
                closeCodeBlock();
            } else {
                flushBreaks(2);
                inCodeBlock = true;
                codeLines = [];
            }
            continue;
        }

        if (inCodeBlock) {
            codeLines.push(rawLine);
            continue;
        }

        const line = rawLine.trim();
        const isTableLine = line.startsWith('|') && line.includes('|');

        if (isTableLine) {
            if (!inTable) {
                flushBreaks(1);
                inTable = true;
                tableRows = [];
            }

            tableRows.push(splitTableCells(line));
            continue;
        }

        closeTable();

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

        const quoteMatch = line.match(/^>\s+(.+)$/);
        if (quoteMatch) {
            flushBreaks(2);
            const content = formatInline(quoteMatch[1]);
            if (content) {
                parts.push(`<blockquote>${content}</blockquote>`);
                pendingBreaks = 1;
            }
            continue;
        }

        const unorderedMatch = line.match(/^[-*+\u2022]\s+(.+)$/);
        if (unorderedMatch) {
            flushBreaks(2);
            const content = formatInline(unorderedMatch[1]);
            if (content) {
                parts.push(`&#8226; ${content}`);
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

    closeTable();
    closeCodeBlock();

    return parts.join('')
        .replace(/^(<br>\s*)+/, '')
        .replace(/(<br>\s*)+$/, '');
}

export function extractSuggestions(text: string): string[] {
    const match = findSuggestionBlock(text.trimEnd());

    if (!match) {
        return [];
    }

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
