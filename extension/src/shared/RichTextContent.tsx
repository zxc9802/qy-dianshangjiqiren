import { Fragment, type ReactNode } from 'react';

type RichBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'ul' | 'ol'; items: string[] };

function cleanResidualMarkdown(text: string): string {
  return text
    .replace(/\\([*_#`])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*#]+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const source = text.replace(/\r/g, '');
  const parts: ReactNode[] = [];
  const pattern = /(\*\*|__)(.+?)\1/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIndex = 0;

  while ((match = pattern.exec(source)) !== null) {
    const before = cleanResidualMarkdown(source.slice(lastIndex, match.index));
    if (before) {
      parts.push(<Fragment key={`${keyPrefix}-text-${partIndex}`}>{before}</Fragment>);
      partIndex += 1;
    }

    const strongText = cleanResidualMarkdown(match[2] || '');
    if (strongText) {
      parts.push(<strong key={`${keyPrefix}-strong-${partIndex}`}>{strongText}</strong>);
      partIndex += 1;
    }

    lastIndex = match.index + match[0].length;
  }

  const trailing = cleanResidualMarkdown(source.slice(lastIndex));
  if (trailing) {
    parts.push(<Fragment key={`${keyPrefix}-text-${partIndex}`}>{trailing}</Fragment>);
  }

  if (parts.length > 0) {
    return parts;
  }

  const fallback = cleanResidualMarkdown(source);
  return fallback ? [<Fragment key={`${keyPrefix}-fallback`}>{fallback}</Fragment>] : [];
}

function parseBlocks(content: string): RichBlock[] {
  const lines = content.replace(/\r/g, '').split('\n');
  const blocks: RichBlock[] = [];
  let paragraphLines: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push({ type: 'paragraph', lines: paragraphLines });
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    blocks.push({ type: listType, items: listItems });
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s*(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: Math.min(headingMatch[1].length, 4),
        text: headingMatch[2],
      });
      continue;
    }

    const unorderedMatch = line.match(/^[-*+•]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(unorderedMatch[1]);
      continue;
    }

    const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(orderedMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

export function RichTextContent({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseBlocks(content);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className={`rich-content ${className}`.trim()}>
      {blocks.map((block, blockIndex) => {
        if (block.type === 'heading') {
          const headingLevel = `rich-heading level-${block.level}`;
          return (
            <div key={`heading-${blockIndex}`} className={headingLevel}>
              {renderInline(block.text, `heading-${blockIndex}`)}
            </div>
          );
        }

        if (block.type === 'paragraph') {
          return (
            <div key={`paragraph-${blockIndex}`} className="rich-paragraph">
              {block.lines.map((line, lineIndex) => (
                <Fragment key={`paragraph-${blockIndex}-line-${lineIndex}`}>
                  {lineIndex > 0 ? <br /> : null}
                  {renderInline(line, `paragraph-${blockIndex}-${lineIndex}`)}
                </Fragment>
              ))}
            </div>
          );
        }

        const ListTag = block.type === 'ol' ? 'ol' : 'ul';
        return (
          <ListTag key={`list-${blockIndex}`} className={`rich-list rich-list-${block.type}`}>
            {block.items.map((item, itemIndex) => (
              <li key={`list-${blockIndex}-item-${itemIndex}`}>
                {renderInline(item, `list-${blockIndex}-${itemIndex}`)}
              </li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
}
