import { prisma } from './prisma';
import { AppError } from './auth';
import { readServerEnv } from './server-env';
import { BUILTIN_BOT_MAP } from './builtin-bots';
import { getSystemPromptByBotId } from './server-bot-prompts';
import type {
    ExtensionBot,
    ExtensionChatMessage,
    ExtensionChatMode,
    PageContext,
} from './extension-types';

const DEFAULT_STREAM_URL = 'https://yunwu.ai/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse';

const EXTENSION_CHAT_RULES = `
你正在浏览器插件里为用户服务。

- 回答必须使用中文。
- 优先基于当前网页上下文作答，必要时明确说明哪些信息来自网页上下文、哪些是你的推断。
- 输出直接、结构清晰、可执行，不要附加 JSON 建议按钮。
- 如果网页上下文不足以支撑结论，要明确指出不足，而不是假装看到了不存在的信息。
`.trim();

function normalizeStreamUrl(rawUrl?: string): string {
    let url = (rawUrl || DEFAULT_STREAM_URL).trim();
    url = url.replace(':generateContent', ':streamGenerateContent');
    if (!/[?&]alt=sse(?:&|$)/.test(url)) {
        url += url.includes('?') ? '&alt=sse' : '?alt=sse';
    }
    return url;
}

function trimText(text: string, max: number): string {
    return text.trim().slice(0, max);
}

export function buildPageContextBlock(pageContext: PageContext): string {
    const sections: string[] = [
        `页面标题：${pageContext.title || '未识别'}`,
        `页面链接：${pageContext.url || '未识别'}`,
        `页面域名：${pageContext.domain || '未识别'}`,
    ];

    if (pageContext.selectedText) {
        sections.push(`用户当前选中文本：\n${trimText(pageContext.selectedText, 1200)}`);
    }

    if (pageContext.metaDescription) {
        sections.push(`页面简介：\n${trimText(pageContext.metaDescription, 1000)}`);
    }

    if (pageContext.hasVideo) {
        sections.push(`页面包含视频：是`);
        if (pageContext.videoTitle) {
            sections.push(`视频标题：${trimText(pageContext.videoTitle, 500)}`);
        }
        if (pageContext.videoDescription) {
            sections.push(`视频说明：\n${trimText(pageContext.videoDescription, 1600)}`);
        }
        if (pageContext.captionsText) {
            sections.push(
                `视频字幕（来源：${pageContext.transcriptSource}）：\n${trimText(pageContext.captionsText, 3500)}`,
            );
        }
    }

    if (pageContext.mainText) {
        sections.push(`页面正文：\n${trimText(pageContext.mainText, 5000)}`);
    }

    return sections.join('\n\n');
}

export async function resolveExtensionBot(userId: string, botId: string): Promise<{
    bot: ExtensionBot;
    systemPrompt: string;
}> {
    if (botId.startsWith('custom-')) {
        const customBotId = botId.slice('custom-'.length);
        const customBot = await prisma.customBot.findFirst({
            where: {
                id: customBotId,
                userId,
                isActive: true,
            },
            include: {
                documents: {
                    select: {
                        fileName: true,
                        parsedText: true,
                    },
                },
            },
        });

        if (!customBot) {
            throw new AppError('智能体不存在或已删除', 404);
        }

        let systemPrompt = customBot.systemPrompt.trim();

        if (customBot.documents.length > 0) {
            const knowledgeBlock = customBot.documents
                .map((doc) => `### 文档：${doc.fileName}\n${trimText(doc.parsedText, 6000)}`)
                .join('\n\n---\n\n');
            systemPrompt += `\n\n---\n# 参考知识库\n以下内容来自用户上传的文档，请优先基于这些资料回答：\n\n${knowledgeBlock}`;
        }

        return {
            bot: {
                botId,
                kind: 'custom',
                name: customBot.name,
                description: customBot.description,
                icon: customBot.avatar || customBot.icon || 'bot',
                category: '我的智能体',
                pointsPerUse: customBot.pointsPerUse,
            },
            systemPrompt: `${systemPrompt}\n\n${EXTENSION_CHAT_RULES}`.trim(),
        };
    }

    const builtin = BUILTIN_BOT_MAP[botId];
    if (!builtin) {
        throw new AppError('预设机器人不存在', 404);
    }

    const prompt = getSystemPromptByBotId(
        botId,
        `你是${builtin.name}，请给出专业、结构化、可执行的建议。`,
    );

    return {
        bot: {
            botId,
            kind: 'builtin',
            name: builtin.name,
            description: builtin.description,
            icon: builtin.icon,
            category: builtin.category,
            pointsPerUse: builtin.pointsPerUse,
        },
        systemPrompt: `${prompt}\n\n${EXTENSION_CHAT_RULES}`.trim(),
    };
}

export function buildExtensionContents(
    mode: ExtensionChatMode,
    messages: ExtensionChatMessage[],
    pageContext?: PageContext,
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
    if (mode === 'summary') {
        if (!pageContext) {
            throw new AppError('summary 模式缺少 pageContext');
        }
        const contextBlock = buildPageContextBlock(pageContext);
        return [{
            role: 'user',
            parts: [{
                text: `请总结当前页面内容。\n\n要求：\n1. 先用一句话说明页面主题。\n2. 再输出 3-5 条要点。\n3. 如果页面包含视频，要单独说明视频讲了什么，以及字幕是否充分。\n4. 如果信息不足，要明确指出。\n\n网页上下文：\n${contextBlock}`,
            }],
        }];
    }

    const sanitizedMessages = messages
        .filter((message) => message.content.trim().length > 0)
        .map((message) => ({
            role: message.role === 'assistant' ? 'model' as const : 'user' as const,
            parts: [{ text: message.content.trim() }],
        }));

    if (sanitizedMessages.length === 0) {
        throw new AppError('messages 不能为空');
    }

    if (!pageContext) {
        return sanitizedMessages;
    }

    const contextBlock = buildPageContextBlock(pageContext);
    const firstUserIndex = sanitizedMessages.findIndex((message) => message.role === 'user');

    if (firstUserIndex === -1) {
        return [{
            role: 'user',
            parts: [{ text: `以下是当前网页上下文：\n${contextBlock}` }],
        }, ...sanitizedMessages];
    }

    const nextMessages = [...sanitizedMessages];
    const firstUser = nextMessages[firstUserIndex];
    nextMessages[firstUserIndex] = {
        ...firstUser,
        parts: [{
            text: `以下是当前网页上下文，请基于这些内容回答后续问题：\n${contextBlock}\n\n用户问题：\n${firstUser.parts[0]?.text || ''}`,
        }],
    };
    return nextMessages;
}

export async function streamExtensionCompletion(
  systemPrompt: string,
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
  onText: (text: string) => void,
): Promise<void> {
    const apiKey = readServerEnv('YUNWU_CHAT_API_KEY') || readServerEnv('AI_API_KEY');
    if (!apiKey) {
        throw new AppError('缺少聊天 API Key 配置', 500);
    }

    const apiUrl = normalizeStreamUrl(readServerEnv('YUNWU_CHAT_API_URL') || readServerEnv('AI_API_URL'));
    const upstream = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: systemPrompt }],
            },
            contents,
            generationConfig: {
                temperature: 0.8,
                topP: 0.95,
            },
        }),
    });

    if (!upstream.ok || !upstream.body) {
        const errorText = await upstream.text().catch(() => upstream.statusText);
        throw new AppError(`上游模型请求失败：${errorText}`, upstream.status);
    }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });

    const lines = pending.split('\n');
    pending = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        const data = JSON.parse(jsonStr);
        const parts = data?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) continue;

        for (const part of parts) {
          if (part?.text && !part?.thought) {
            onText(part.text);
          }
        }
      } catch {
        continue;
      }
    }

    if (done) break;
  }

  if (pending.trim().startsWith('data: ')) {
    try {
      const data = JSON.parse(pending.trim().slice(6));
      const parts = data?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part?.text && !part?.thought) {
            onText(part.text);
          }
        }
      }
    } catch {
      // Ignore trailing partial chunk.
    }
  }
}
