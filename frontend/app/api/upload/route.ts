import { NextRequest, NextResponse } from 'next/server';
import { readServerEnv } from '../../lib/server-env';

const API_KEY = readServerEnv('YUNWU_UPLOAD_API_KEY') || readServerEnv('AI_API_KEY') || '';

const MIME_MAP: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const TEXT_EXTS = new Set(['txt', 'md', 'csv']);

function normalizeStreamUrl(rawUrl?: string): string {
    const defaultUrl = 'https://yunwu.ai/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse';
    let url = (rawUrl || defaultUrl).trim();
    url = url.replace(':generateContent', ':streamGenerateContent');

    if (!/[?&]alt=sse(?:&|$)/.test(url)) {
        url += url.includes('?') ? '&alt=sse' : '?alt=sse';
    }

    return url;
}

function parseSseText(sseBody: string): string {
    let result = '';

    for (const line of sseBody.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
            const data = JSON.parse(jsonStr);
            const parts = data?.candidates?.[0]?.content?.parts;
            if (!Array.isArray(parts)) continue;

            for (const part of parts) {
                if (part?.text && !part?.thought) {
                    result += part.text;
                }
            }
        } catch {
            continue;
        }
    }

    return result;
}

async function parseDocumentLocally(buffer: Buffer, ext: string): Promise<string> {
    if (TEXT_EXTS.has(ext)) {
        const text = buffer.toString('utf-8');
        if (!text.trim()) throw new Error('文件内容为空');
        return text;
    }

    if (ext === 'docx') {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        if (!result.value.trim()) throw new Error('Word 文档内容为空');
        console.log(`[Upload] DOCX parsed: ${result.value.length} chars, ${result.messages.length} warnings`);
        return result.value;
    }

    if (ext === 'pdf') {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        try {
            const result = await parser.getText();
            if (!result.text.trim()) throw new Error('PDF 文档内容为空');
            console.log(`[Upload] PDF parsed: ${result.text.length} chars, ${result.total} pages`);
            return result.text;
        } finally {
            await parser.destroy();
        }
    }

    if (ext === 'doc') {
        throw new Error('不支持 .doc 格式，请将文件另存为 .docx 后重试');
    }

    if (ext === 'pptx') {
        throw new Error('PPT 本地解析暂不支持，请将内容复制到 Word 或 TXT 后上传');
    }

    throw new Error(`不支持的文档格式: .${ext}`);
}

async function parseImageWithAI(base64Data: string, mimeType: string, fileName: string): Promise<string> {
    const apiUrl = normalizeStreamUrl(readServerEnv('YUNWU_UPLOAD_API_URL') || readServerEnv('AI_API_URL'));
    console.log(`[Upload] Sending image ${fileName} to Gemini API...`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const upstream = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
            contents: [{
                role: 'user',
                parts: [
                    {
                        inlineData: { mimeType, data: base64Data },
                    },
                    {
                        text: '请详细描述这张图片的内容，包括画面中的文字、物体、布局、颜色等所有可见信息。',
                    },
                ],
            }],
            generationConfig: {
                temperature: 0.1,
                topP: 1,
            },
        }),
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
        const errText = await upstream.text();
        console.error(`[Upload] Gemini error for ${fileName}: status=${upstream.status}`, errText.slice(0, 300));
        throw new Error(`图片解析失败 (API ${upstream.status})`);
    }

    const sseBody = await upstream.text();
    const extractedText = parseSseText(sseBody);
    console.log(`[Upload] Image parsed: ${extractedText.length} chars`);

    if (!extractedText.trim()) {
        throw new Error('无法从图片中提取内容');
    }

    return extractedText;
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: '未选择文件' }, { status: 400 });
        }

        const maxSize = 20 * 1024 * 1024;
        if (file.size > maxSize) {
            return NextResponse.json({ error: '文件大小不能超过20MB' }, { status: 400 });
        }

        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const mimeType = MIME_MAP[ext];
        if (!mimeType) {
            return NextResponse.json(
                { error: '不支持的文件格式，请上传 PDF、Word、TXT、MD、CSV 或图片文件' },
                { status: 400 },
            );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        let extractedText: string;

        if (IMAGE_EXTS.has(ext)) {
            if (!API_KEY) {
                return NextResponse.json({ error: 'Missing API key' }, { status: 500 });
            }
            const base64Data = buffer.toString('base64');
            extractedText = await parseImageWithAI(base64Data, mimeType, file.name);
        } else {
            console.log(`[Upload] Parsing ${file.name} locally (${(file.size / 1024).toFixed(1)}KB)...`);
            extractedText = await parseDocumentLocally(buffer, ext);
        }

        return NextResponse.json({
            fileName: file.name,
            fileSize: file.size,
            content: extractedText.trim(),
        });
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            return NextResponse.json({ error: '图片解析超时（60秒）' }, { status: 504 });
        }

        const msg = err instanceof Error ? err.message : '文件解析失败';
        console.error('[Upload] Error:', msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
