/**
 * Shared message formatter: converts AI markdown output to clean, user-friendly HTML.
 * Strips raw markdown symbols (#, *, ```) and hides the suggestions JSON block.
 */
export function formatMessage(text: string): string {
    // 1. Remove the ```json suggestions block entirely
    let cleaned = text.replace(/```json\s*\{[\s\S]*?"suggestions"[\s\S]*?\}\s*```/g, '');

    // 2. Remove trailing ``` that might be left
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    cleaned = cleaned.replace(/```/g, '');

    // 3. HTML-escape
    let html = cleaned
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 4. Convert markdown to readable HTML
    // Headers: ### → bold text, ## → bold text, # → bold text
    html = html.replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>');

    // Bold: **text**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Italic: *text* (single asterisk)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Numbered lists: "1. text" → clean numbered text
    html = html.replace(/^\d+\.\s+/gm, '• ');

    // Bullet lists: "- text" → clean bullet
    html = html.replace(/^[-]\s+/gm, '• ');

    // Remove remaining standalone *, #, --- separators
    html = html.replace(/^---+$/gm, '');
    html = html.replace(/^\*{3,}$/gm, '');

    // 5. Table parsing (keep from original)
    const lines = html.split('\n');
    let inTable = false;
    const result: string[] = [];

    for (const line of lines) {
        if (line.includes('|') && line.trim().startsWith('|')) {
            const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
            if (cells.every(c => /^[-:]+$/.test(c))) continue;
            if (!inTable) {
                result.push('<table>');
                inTable = true;
            }
            result.push('<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>');
        } else {
            if (inTable) {
                result.push('</table>');
                inTable = false;
            }
            result.push(line);
        }
    }
    if (inTable) result.push('</table>');

    // 6. Convert newlines to <br>, clean up around tables
    let final = result.join('<br>')
        .replace(/<br><table>/g, '<table>')
        .replace(/<\/table><br>/g, '</table>');

    // 7. Remove excessive <br> (3+ in a row → 2)
    final = final.replace(/(<br>){3,}/g, '<br><br>');

    // 8. Trim leading/trailing <br>
    final = final.replace(/^(<br>)+/, '').replace(/(<br>)+$/, '');

    return final;
}

/**
 * Extract suggestion buttons from AI response text.
 * Returns the suggestions array if found, or empty array.
 */
export function extractSuggestions(text: string): string[] {
    const match = text.match(/```json\s*(\{[\s\S]*?"suggestions"[\s\S]*?\})\s*```/);
    if (!match) return [];
    try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed.suggestions)) {
            return parsed.suggestions;
        }
    } catch { /* ignore */ }
    return [];
}
