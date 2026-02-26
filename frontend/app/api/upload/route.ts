import { NextRequest, NextResponse } from 'next/server';

const API_URL = 'https://yunwu.ai/v1beta/models/gemini-2.5-pro:generateContent';
const API_KEY = 'sk-JrZjjnwnrtkLV8i3v8K2TSV9CLTpmHqx0twPjDIjyGYfBuYO';

const MIME_MAP: Record<string, string> = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'csv': 'text/csv',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

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
                { error: '不支持的文件格式，请上传 PDF、Word、PPT、TXT、MD、CSV 或图片文件' },
                { status: 400 }
            );
        }

        // Convert file to base64
        const buffer = Buffer.from(await file.arrayBuffer());
        const base64Data = buffer.toString('base64');

        // Send to Gemini with inline data
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                mimeType,
                                data: base64Data,
                            },
                        },
                        {
                            text: IMAGE_EXTS.has(ext)
                                ? '请详细描述这张图片的内容，包括画面中的文字、物体、布局、颜色等所有视觉信息。'
                                : '请阅读这个文件，提取其中的全部文字内容，原样输出，不要添加任何额外的解释或总结。如果文件中有表格，请用markdown表格格式输出。',
                        },
                    ],
                }],
                generationConfig: {
                    temperature: 0.1,
                    topP: 1,
                },
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error('Gemini file read error:', errText);
            return NextResponse.json({ error: '文件解析失败' }, { status: 500 });
        }

        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts;
        let extractedText = '';

        if (parts) {
            for (const part of parts) {
                if (part.text) extractedText += part.text;
            }
        }

        if (!extractedText.trim()) {
            return NextResponse.json({ error: '无法从文件中提取内容' }, { status: 400 });
        }

        return NextResponse.json({
            fileName: file.name,
            fileSize: file.size,
            content: extractedText.trim(),
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : '文件解析失败';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
