export interface StreamingMarkdownBlocks {
    stableBlocks: string[];
    activeBlock: string;
}

export function splitStreamingMarkdownBlocks(input: string): StreamingMarkdownBlocks {
    const text = input.replace(/\r/g, '');

    if (!text.trim()) {
        return { stableBlocks: [], activeBlock: '' };
    }

    const stableBlocks: string[] = [];
    const currentBlock: string[] = [];
    let inCodeFence = false;

    const flushCurrentBlock = () => {
        const block = currentBlock.join('\n').trimEnd();
        currentBlock.length = 0;

        if (block.trim()) {
            stableBlocks.push(block);
        }
    };

    for (const line of text.split('\n')) {
        const isFenceLine = line.trimStart().startsWith('```');

        if (isFenceLine) {
            currentBlock.push(line);
            inCodeFence = !inCodeFence;
            continue;
        }

        if (!inCodeFence && line.trim() === '') {
            flushCurrentBlock();
            continue;
        }

        currentBlock.push(line);
    }

    const activeBlock = currentBlock.join('\n').trimEnd();
    return {
        stableBlocks,
        activeBlock: activeBlock.trim() ? activeBlock : '',
    };
}
