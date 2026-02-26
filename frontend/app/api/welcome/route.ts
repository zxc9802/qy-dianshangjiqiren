import { NextRequest, NextResponse } from 'next/server';

const API_URL = 'https://yunwu.ai/v1beta/models/gemini-2.5-pro:generateContent';
const API_KEY = 'sk-JrZjjnwnrtkLV8i3v8K2TSV9CLTpmHqx0twPjDIjyGYfBuYO';

export async function POST(req: NextRequest) {
    try {
        const { systemPrompt, userMessage } = await req.json();

        const res = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: systemPrompt }],
                },
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: userMessage }],
                    },
                ],
                generationConfig: {
                    temperature: 1,
                    topP: 1,
                },
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            return NextResponse.json({ error: errText }, { status: res.status });
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts
            ?.filter((p: { text?: string; thought?: boolean }) => !p.thought)
            ?.map((p: { text?: string }) => p.text)
            ?.join('') || '你好，请告诉我你的需求。';

        // Extract suggestions if present
        let content = text;
        let suggestions: string[] = [];
        const match = content.match(/```json\s*(\{"suggestions":\s*\[.*?\]\})\s*```/s);
        if (match) {
            try {
                const parsed = JSON.parse(match[1]);
                if (parsed.suggestions) suggestions = parsed.suggestions;
                content = content.replace(match[0], '').trim();
            } catch { /* ignore */ }
        }

        return NextResponse.json({ content, suggestions });
    } catch (err) {
        const msg = err instanceof Error ? err.message : '未知错误';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
