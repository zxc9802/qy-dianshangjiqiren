import { NextRequest } from 'next/server';
import { getSystemPromptByBotId } from '../../lib/server-bot-prompts';
import { readBackendUrl, readServerEnv } from '../../lib/server-env';

const DEFAULT_API_URL = 'https://yunwu.ai/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse';
const API_KEY = readServerEnv('YUNWU_CHAT_API_KEY') || readServerEnv('AI_API_KEY') || '';

const GLOBAL_RULES = `
# ????
- ???????????????
- ????????????????????
- ?????? emoji?
`;

const XHS_GLOBAL_RULES = `${GLOBAL_RULES}
- ????????????? emoji???????`;

function normalizeStreamUrl(rawUrl?: string): string {
    let url = (rawUrl || DEFAULT_API_URL).trim();
    url = url.replace(':generateContent', ':streamGenerateContent');

    if (!/[?&]alt=sse(?:&|$)/.test(url)) {
        url += url.includes('?') ? '&alt=sse' : '?alt=sse';
    }

    return url;
}

function parseSseLine(line: string): string[] {
    if (!line.startsWith('data: ')) return [];

    const jsonStr = line.slice(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') return [];

    try {
        const data = JSON.parse(jsonStr);
        const parts = data?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) return [];

        return parts
            .filter((part: { text?: string; thought?: boolean }) => !part?.thought && typeof part?.text === 'string')
            .map((part: { text: string }) => part.text);
    } catch {
        return [];
    }
}

export async function POST(req: NextRequest) {
    try {
        if (!API_KEY) {
            return new Response(JSON.stringify({ error: 'Missing chat API key configuration' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const { botId, systemPrompt, messages, message, conversationHistory, wfContext } = await req.json();
        const botIdString = String(botId ?? '');
        const fallbackPrompt = typeof systemPrompt === 'string' && systemPrompt.trim()
            ? systemPrompt.trim()
            : '??????? AI ???';

        let fullSystemPrompt: string;

        if (botIdString.startsWith('custom-')) {
            // Custom bot 鈥?fetch from backend API
            const customId = botIdString.replace('custom-', '');
            const token = req.headers.get('x-auth-token') || '';
            try {
                const backendUrl = readBackendUrl();
                const botRes = await fetch(`${backendUrl}/api/custom-bots/${customId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (botRes.ok) {
                    const botData = await botRes.json();
                    const bot = botData.data;
                    let prompt = bot.systemPrompt || fallbackPrompt;

                    // Inject knowledge base documents
                    if (bot.documents && bot.documents.length > 0) {
                        const knowledgeTexts = bot.documents
                            .map((doc: { fileName: string; parsedText: string }) =>
                                `### 鏂囨。: ${doc.fileName}\n${doc.parsedText}`
                            )
                            .join('\n\n---\n\n');
                        prompt += `\n\n---\n# 鐭ヨ瘑搴揬n浠ヤ笅鏄敤鎴蜂笂浼犵殑鍙傝€冩枃妗ｏ紝璇峰熀浜庤繖浜涘唴瀹瑰洖绛旈棶棰橈細\n\n${knowledgeTexts}`;
                    }

                    fullSystemPrompt = `${prompt}\n\n${GLOBAL_RULES}`.trim();
                } else {
                    fullSystemPrompt = `${fallbackPrompt}\n\n${GLOBAL_RULES}`.trim();
                }
            } catch {
                fullSystemPrompt = `${fallbackPrompt}\n\n${GLOBAL_RULES}`.trim();
            }
        } else {
            const id = Number(botIdString);
            const isXhs = Number.isFinite(id) && id >= 15 && id <= 22;
            const promptFromDocs = getSystemPromptByBotId(botIdString, fallbackPrompt);
            fullSystemPrompt = `${promptFromDocs}\n\n${isXhs ? XHS_GLOBAL_RULES : GLOBAL_RULES}`.trim();
        }

        // Inject workflow context from previous step
        if (typeof wfContext === 'string' && wfContext.trim()) {
            fullSystemPrompt += `\n\n---\n# 涓婁竴姝ュ伐浣滄祦浼犻€掔殑鍐呭锛堜綔涓哄弬鑰冭儗鏅級\n浠ヤ笅鏄敤鎴峰湪涔嬪墠姝ラ涓笌鍏朵粬AI鐨勫璇濇垚鏋滐紝璇峰熀浜庤繖浜涘唴瀹圭户缁彁渚涘府鍔╋細\n\n${wfContext.trim()}`;
        }

        const normalizedMessages = Array.isArray(messages)
            ? messages
            : [
                ...(Array.isArray(conversationHistory) ? conversationHistory : []),
                ...(typeof message === 'string' && message.trim() ? [{ role: 'user', content: message }] : []),
            ];
        const contents = normalizedMessages
            .filter((msg: { role?: string; content?: string }) => typeof msg?.content === 'string' && msg.content.trim().length > 0)
            .map((msg: { role: string; content: string }) => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }],
            }));

        if (contents.length === 0) {
            return new Response(JSON.stringify({ error: 'messages is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const apiUrl = normalizeStreamUrl(readServerEnv('YUNWU_CHAT_API_URL') || readServerEnv('AI_API_URL'));
        const upstream = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: fullSystemPrompt }],
                },
                contents,
                generationConfig: {
                    temperature: 1,
                    topP: 1,
                },
            }),
        });

        if (!upstream.ok) {
            const errText = await upstream.text();
            return new Response(JSON.stringify({ error: errText }), {
                status: upstream.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                const reader = upstream.body!.getReader();
                const decoder = new TextDecoder();
                let pending = '';

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        pending += decoder.decode(value, { stream: true });
                        const lines = pending.split('\n');
                        pending = lines.pop() || '';

                        for (const line of lines) {
                            const texts = parseSseLine(line.trim());
                            for (const text of texts) {
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`));
                            }
                        }
                    }

                    if (pending.trim()) {
                        const texts = parseSseLine(pending.trim());
                        for (const text of texts) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`));
                        }
                    }

                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
                } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Stream error';
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: msg })}\n\n`));
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            },
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : '鏈煡閿欒';
        return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}


