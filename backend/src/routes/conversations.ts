import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/error';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { getSystemPromptBySortOrder, isPlaceholderPrompt } from '../utils/systemPrompts';

const router = Router();
router.use(authMiddleware);

function normalizeStreamUrl(rawUrl?: string): string {
    let url = (rawUrl || 'https://yunwu.ai/v1beta/models/gemini-3-flash-preview:streamGenerateContent').trim();
    url = url.replace(':generateContent', ':streamGenerateContent');

    if (!/[?&]alt=sse(?:&|$)/.test(url)) {
        url += url.includes('?') ? '&alt=sse' : '?alt=sse';
    }

    return url;
}

// 创建对话
router.post('/', async (req: AuthRequest, res: Response) => {
    const { botId } = z.object({ botId: z.string().uuid() }).parse(req.body);

    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new AppError('智能体不存在', 404);

    const conversation = await prisma.conversation.create({
        data: { userId: req.userId!, botId, title: `与${bot.name}的对话` },
        include: { bot: { select: { name: true, icon: true, category: true } } },
    });

    res.status(201).json({ success: true, data: conversation });
});

// 获取对话列表
router.get('/', async (req: AuthRequest, res: Response) => {
    const { botId, favorited, page = '1', limit = '20' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { userId: req.userId };
    if (botId && typeof botId === 'string') where.botId = botId;
    if (favorited === 'true') where.isFavorited = true;

    const [conversations, total] = await Promise.all([
        prisma.conversation.findMany({
            where,
            include: {
                bot: { select: { name: true, icon: true, category: true } },
                messages: { take: 1, orderBy: { createdAt: 'desc' }, select: { content: true, createdAt: true } },
            },
            orderBy: { updatedAt: 'desc' },
            skip,
            take: Number(limit),
        }),
        prisma.conversation.count({ where }),
    ]);

    res.json({ success: true, data: { conversations, total, page: Number(page), limit: Number(limit) } });
});

// 获取对话详情 + 消息
router.get('/:id', async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const conversation = await prisma.conversation.findFirst({
        where: { id, userId: req.userId },
        include: {
            bot: { select: { id: true, name: true, icon: true, category: true, pointsPerUse: true } },
            messages: { orderBy: { createdAt: 'asc' }, include: { attachments: true } },
        },
    });
    if (!conversation) throw new AppError('对话不存在', 404);
    res.json({ success: true, data: conversation });
});

// 发送消息（SSE流式返回）
router.post('/:id/messages', async (req: AuthRequest, res: Response) => {
    const convId = req.params.id as string;
    const { content, inputType } = z.object({
        content: z.string().min(1),
        inputType: z.enum(['text', 'voice', 'file']).default('text'),
    }).parse(req.body);

    const conversation = await prisma.conversation.findFirst({
        where: { id: convId, userId: req.userId },
        include: { bot: true, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new AppError('对话不存在', 404);

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user || user.pointsBalance < conversation.bot.pointsPerUse) {
        throw new AppError('积分不足，请先充值', 402);
    }

    // 保存用户消息
    await prisma.message.create({
        data: { conversationId: convId, role: 'user', content, inputType },
    });

    // 组装上下文
    const apiMessages = conversation.messages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }],
    }));
    apiMessages.push({ role: 'user', parts: [{ text: content }] });

    // SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let fullResponse = '';

    try {
        const apiUrl = normalizeStreamUrl(process.env.AI_API_URL);
        const fallbackPrompt = `你是${conversation.bot.name}，请给出专业、结构化、可执行的建议。`;
        const systemPrompt = isPlaceholderPrompt(conversation.bot.systemPrompt)
            ? getSystemPromptBySortOrder(conversation.bot.sortOrder, fallbackPrompt)
            : conversation.bot.systemPrompt;

        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.AI_API_KEY}`,
            },
            body: JSON.stringify({
                contents: apiMessages,
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 8192 },
            }),
        });

        if (!apiResponse.ok || !apiResponse.body) {
            throw new Error(`AI API error: ${apiResponse.status}`);
        }

        const reader = (apiResponse.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (jsonStr === '[DONE]') continue;
                try {
                    const data = JSON.parse(jsonStr);
                    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        fullResponse += text;
                        res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
                    }
                } catch { /* skip malformed */ }
            }
        }

        // 提取 suggestions
        let suggestions: string | null = null;
        const match = fullResponse.match(/```json\s*(\{"suggestions":\s*\[.*?\]\})\s*```/s);
        if (match) {
            suggestions = match[1];
            fullResponse = fullResponse.replace(match[0], '').trim();
        }

        // 保存 AI 回复
        await prisma.message.create({
            data: { conversationId: convId, role: 'assistant', content: fullResponse, suggestions },
        });

        // 扣积分
        const pointsCost = conversation.bot.pointsPerUse;
        await prisma.user.update({
            where: { id: req.userId },
            data: { pointsBalance: { decrement: pointsCost } },
        });
        await prisma.pointsTransaction.create({
            data: {
                userId: req.userId!,
                type: 'consume',
                amount: -pointsCost,
                balanceAfter: user.pointsBalance - pointsCost,
                description: `使用${conversation.bot.name}`,
                relatedConversationId: convId,
            },
        });

        await prisma.conversation.update({
            where: { id: convId },
            data: { updatedAt: new Date() },
        });

        res.write(`data: ${JSON.stringify({ type: 'suggestions', content: suggestions })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done', pointsUsed: pointsCost })}\n\n`);
        res.end();
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : '未知错误';
        res.write(`data: ${JSON.stringify({ type: 'error', content: errMsg })}\n\n`);
        res.end();
    }
});

// 收藏/取消收藏
router.patch('/:id/favorite', async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const conv = await prisma.conversation.findFirst({ where: { id, userId: req.userId } });
    if (!conv) throw new AppError('对话不存在', 404);

    const updated = await prisma.conversation.update({
        where: { id: conv.id },
        data: { isFavorited: !conv.isFavorited },
    });
    res.json({ success: true, data: { isFavorited: updated.isFavorited } });
});

// 删除对话
router.delete('/:id', async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const conv = await prisma.conversation.findFirst({ where: { id, userId: req.userId } });
    if (!conv) throw new AppError('对话不存在', 404);

    await prisma.conversation.delete({ where: { id: conv.id } });
    res.json({ success: true, message: '对话已删除' });
});

export default router;
