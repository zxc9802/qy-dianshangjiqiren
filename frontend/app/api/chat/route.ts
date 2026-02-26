import { NextRequest } from 'next/server';

const API_URL = 'https://yunwu.ai/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse';
const API_KEY = 'sk-JrZjjnwnrtkLV8i3v8K2TSV9CLTpmHqx0twPjDIjyGYfBuYO';

// Global rules appended to every bot's system prompt
const GLOBAL_RULES = `
# 全局交互规则

## 规则1：用户可随时提前结束对话
- 用户在对话的任何阶段都可以选择跳过剩余提问，直接获取结果
- 如果用户说"直接给我方案""够了""不用再问了"等类似表达，你应该立即基于已有信息输出最终结果
- 信息不足的部分，你可以用行业常见做法或合理假设补充，并在输出中标注"[基于假设]"

## 规则2：每次回复末尾提供预设引导（前端按钮）
- 每次回复后，在回复最末尾输出一个 JSON 块，前端会将其解析为可点击的按钮
- 格式如下（必须严格遵守）：
\`\`\`json
{"suggestions": ["选项A的文字", "选项B的文字", "选项C的文字", "直接出方案"]}
\`\`\`
- 选项内容要贴合当前对话阶段，帮用户降低输入成本
- 数量3-4个，始终保留一个"直接出方案"选项

## 规则3：排版与格式
- 回复要结构清晰，善用表格、加粗、分点列表来组织信息
- 避免大段纯文字，每段不超过3-4行
- 不要用emoji，保持专业干净的排版风格
- 像一个合作伙伴一样和用户对话，不要说"我是XX"、"我会帮你分析"之类的话
- 直接切入主题，根据用户的问题深入挖掘
`;

// Xiaohongshu bots can use emoji
const XHS_GLOBAL_RULES = GLOBAL_RULES.replace(
    '不要用emoji，保持专业干净的排版风格',
    '可以适当使用emoji，符合小红书内容风格'
);

export async function POST(req: NextRequest) {
    try {
        const { botId, systemPrompt, messages } = await req.json();

        // Determine if this is a Xiaohongshu bot (IDs 15-22)
        const id = parseInt(botId);
        const isXhs = id >= 15 && id <= 22;
        const fullSystemPrompt = systemPrompt + (isXhs ? XHS_GLOBAL_RULES : GLOBAL_RULES);

        // Build Gemini contents from message history
        const contents = messages.map((msg: { role: string; content: string }) => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
        }));

        const res = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
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

        if (!res.ok) {
            const errText = await res.text();
            return new Response(JSON.stringify({ error: errText }), {
                status: res.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Stream the response back to the client
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                const reader = res.body!.getReader();
                const decoder = new TextDecoder();

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        const chunk = decoder.decode(value, { stream: true });
                        for (const line of chunk.split('\n')) {
                            if (!line.startsWith('data: ')) continue;
                            const jsonStr = line.slice(6).trim();
                            if (!jsonStr || jsonStr === '[DONE]') continue;

                            try {
                                const data = JSON.parse(jsonStr);
                                const parts = data?.candidates?.[0]?.content?.parts;
                                if (!parts) continue;

                                for (const part of parts) {
                                    if (part.thought) continue; // Skip thinking tokens
                                    if (part.text) {
                                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: part.text })}\n\n`));
                                    }
                                }
                            } catch {
                                // Skip unparseable chunks
                            }
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
                'Connection': 'keep-alive',
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
