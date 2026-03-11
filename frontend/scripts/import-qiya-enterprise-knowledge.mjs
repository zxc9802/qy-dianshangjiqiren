import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..');

const OUTPUT_PATH = path.join(
  frontendRoot,
  'app',
  'lib',
  'builtin-knowledge',
  'qiya-enterprise-management.json',
);

const SOURCES = [
  {
    id: 'huangxu-basic',
    title: '黄旭管理课基础整理稿 (1)',
    filePath: 'C:/Users/78575/Desktop/黄旭管理课基础整理稿 (1).docx',
  },
  {
    id: 'huangxu-full',
    title: '黄旭管理课正式整理稿（完整版）',
    filePath: 'C:/Users/78575/Desktop/黄旭管理课正式整理稿（完整版）.docx',
  },
  {
    id: 'company-goals',
    title: '公司目标',
    filePath: 'C:/Users/78575/Desktop/公司目标.docx',
  },
];

const TARGET_CHUNK_LENGTH = 850;
const MAX_CHUNK_LENGTH = 950;
const OVERLAP_CHARS = 120;

function cleanText(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/\u0007/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function splitLongText(text) {
  const normalized = text.trim();
  if (normalized.length <= MAX_CHUNK_LENGTH) {
    return [normalized];
  }

  const sentences = normalized
    .split(/(?<=[。！？；!?;])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    const fallbackChunks = [];
    let start = 0;
    while (start < normalized.length) {
      fallbackChunks.push(normalized.slice(start, start + TARGET_CHUNK_LENGTH).trim());
      start += TARGET_CHUNK_LENGTH - OVERLAP_CHARS;
    }
    return fallbackChunks.filter(Boolean);
  }

  const chunks = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
  };

  for (const sentence of sentences) {
    const candidate = current ? `${current}${sentence}` : sentence;
    if (candidate.length <= MAX_CHUNK_LENGTH) {
      current = candidate;
      continue;
    }

    flush();
    const overlap = current.trim().slice(-OVERLAP_CHARS).trim();
    current = overlap ? `${overlap}${sentence}` : sentence;

    if (current.length > MAX_CHUNK_LENGTH) {
      chunks.push(...splitLongText(current));
      current = '';
    }
  }

  flush();
  return chunks.filter(Boolean);
}

function chunkText(text) {
  const paragraphs = cleanText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
  };

  for (const paragraph of paragraphs) {
    const units = paragraph.length > MAX_CHUNK_LENGTH ? splitLongText(paragraph) : [paragraph];

    for (const unit of units) {
      const candidate = current ? `${current}\n\n${unit}` : unit;
      if (candidate.length <= MAX_CHUNK_LENGTH) {
        current = candidate;
        continue;
      }

      flush();
      const overlap = current.trim().slice(-OVERLAP_CHARS).trim();
      current = overlap ? `${overlap}\n${unit}` : unit;

      if (current.length > MAX_CHUNK_LENGTH) {
        chunks.push(...splitLongText(current));
        current = '';
      }
    }
  }

  flush();
  return chunks.filter(Boolean);
}

async function extractDocxText(filePath) {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return cleanText(result.value);
}

async function main() {
  const sources = [];
  const chunks = [];

  for (const source of SOURCES) {
    const text = await extractDocxText(source.filePath);
    const sourceChunks = chunkText(text);

    sources.push({
      id: source.id,
      title: source.title,
      charCount: text.length,
      chunkCount: sourceChunks.length,
    });

    sourceChunks.forEach((chunkTextValue, index) => {
      chunks.push({
        id: `${source.id}-${String(index + 1).padStart(3, '0')}`,
        sourceId: source.id,
        sourceTitle: source.title,
        text: chunkTextValue,
      });
    });
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(
    OUTPUT_PATH,
    `${JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      botId: '35',
      sources,
      chunks,
    }, null, 2)}\n`,
    'utf8',
  );

  console.log(`Wrote ${chunks.length} chunks to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
