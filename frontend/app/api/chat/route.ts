import { NextRequest } from 'next/server';
import { getSystemPromptByBotId } from '../../lib/server-bot-prompts';
import { readServerEnv } from '../../lib/server-env';

const DEFAULT_API_URL = 'https://yunwu.ai/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse';
const API_KEY = readServerEnv('YUNWU_CHAT_API_KEY') || readServerEnv('AI_API_KEY') || '';

const GLOBAL_RULES = `
# 全局交互规则

## 规则1：用户可随时提前结束对话
- 用户在对话任何阶段都可以跳过剩余提问，直接获取结果
- 如果用户说“直接给我方案”“够了”“不用再问了”等表达，应立即基于已有信息输出最终结果
- 信息不足时可用行业常见做法或合理假设补充，并在输出中标注 [基于假设]

## 规则2：每次回复末尾提供预设引导（前端按钮）
- 每次回复后，在最末尾输出一个 JSON 块，前端会解析成可点击按钮
- 格式必须严格为：
\`\`\`json
{"suggestions": ["选项A的文字", "选项B的文字", "选项C的文字", "直接出方案"]}
\`\`\`
- 选项内容要贴合当前对话阶段，数量 3-4 个，并始终保留“直接出方案”

## 规则3：排版与格式
- 回复结构清晰，善用表格、加粗、分点列表
- 避免大段纯文字，每段不超过 3-4 行
- 除小红书相关机器人外，不使用 emoji
- 像专业顾问一样直接切入问题，不要寒暄或自我介绍
`;

const XHS_GLOBAL_RULES = GLOBAL_RULES.replace(
    '除小红书相关机器人外，不使用 emoji',
    '小红书相关机器人可以适当使用 emoji，符合平台内容风格'
);

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
            : '你是一个AI助手。';

        let fullSystemPrompt: string;

        if (botIdString.startsWith('custom-')) {
            // Custom bot — fetch from backend API
            const customId = botIdString.replace('custom-', '');
            const token = req.headers.get('x-auth-token') || '';
            try {
                const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
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
                                `### 文档: ${doc.fileName}\n${doc.parsedText}`
                            )
                            .join('\n\n---\n\n');
                        prompt += `\n\n---\n# 知识库\n以下是用户上传的参考文档，请基于这些内容回答问题：\n\n${knowledgeTexts}`;
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
            fullSystemPrompt += `\n\n---\n# 上一步工作流传递的内容（作为参考背景）\n以下是用户在之前步骤中与其他AI的对话成果，请基于这些内容继续提供帮助：\n\n${wfContext.trim()}`;
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
        const msg = err instanceof Error ? err.message : '未知错误';
        return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
