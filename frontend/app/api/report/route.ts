import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, getAuthUser } from '../../lib/auth';
import {
    recordAiUsageEvent,
    releaseAiUsageCredits,
    reserveAiUsageCredits,
} from '../../lib/ai-usage-store';
import { estimateTextUsageReservationCredits } from '../../lib/ai-usage';
import { enforceRateLimit } from '../../lib/security-rate-limit';
import { GPT_5_4_MODEL, requestYunwuOpenAIChat, type OpenAIChatMessage } from '../../lib/yunwu-openai-chat';

const REPORT_USAGE_CHANNEL = 'main-report';
const MAX_REPORT_OUTPUT_TOKENS = 8192;

const REPORT_PROMPT = `你是一位专业的商业分析报告撰写专家。基于以下对话记录，生成一份结构化的分析报告。

请严格按照以下 JSON 格式输出（不要输出任何其他内容，只输出纯 JSON）：

{
  "title": "报告标题（根据对话主题生成，如"KPI考核体系设计分析报告"）",
  "summary": "一段话概括整个对话的核心结论（100字以内）",
  "insights": [
    { "title": "洞察标题", "content": "具体说明", "priority": "high/medium/low" }
  ],
  "actions": [
    { "title": "行动标题", "content": "具体步骤说明", "timeline": "短期/中期/长期", "impact": "预期效果" }
  ],
  "planSummary": "从对话中提炼的核心方案内容（保留关键数据和表格，去除寒暄。用 markdown 格式输出，保留原有的表格格式）",
  "tags": ["标签1", "标签2", "标签3"]
}

注意事项：
- insights 数量 3-5 条，按重要性排列
- actions 数量 3-6 条，按优先级排列
- planSummary 要保留对话中的所有表格和关键数据
- 所有内容用中文
- 只输出 JSON，不要任何额外文字`;

export async function POST(req: NextRequest) {
    try {
        const authUser = await getAuthUser(req);
        await enforceRateLimit({
            scope: 'report:user',
            identifier: authUser.id,
            limit: 10,
            windowMs: 60_000,
        });
        const { botId, botName, messages } = await req.json();

        if (!Array.isArray(messages) || messages.length < 2) {
            return NextResponse.json({ error: '对话记录太少，至少需要一轮对话' }, { status: 400 });
        }

        // Build conversation text for analysis
        const conversationText = messages
            .filter((m: { role: string; content: string }) => m.content && m.content.trim())
            .map((m: { role: string; content: string }) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
            .join('\n\n');

        const reportMessages: OpenAIChatMessage[] = [{
            role: 'user',
            content: `智能体名称：${botName || 'AI助手'}（编号：${botId}）\n\n以下是对话记录：\n\n${conversationText}`,
        }];

        const usageRequestId = randomUUID();
        let creditsReserved = false;
        if (authUser.billingAudience === 'external') {
            const reservationAmount = estimateTextUsageReservationCredits({
                model: GPT_5_4_MODEL,
                promptText: `${REPORT_PROMPT}\n${reportMessages.map((message) => message.content).join('\n')}`,
                maxOutputTokens: MAX_REPORT_OUTPUT_TOKENS,
                billingAudience: 'external',
                groupMultiplier: Number(process.env.YUNWU_OPENAI_CHAT_GROUP_MULTIPLIER) || 1,
                usdCnyRate: Number(process.env.USAGE_MONITOR_USD_CNY_RATE) || 7.3,
            });
            await reserveAiUsageCredits({
                userId: authUser.id,
                channel: REPORT_USAGE_CHANNEL,
                requestId: usageRequestId,
                amount: reservationAmount,
                description: `AI 请求预留 · main report / ${GPT_5_4_MODEL} · 最多 ${reservationAmount} 积分`,
            });
            creditsReserved = true;
        }

        let text = '';
        try {
            text = await requestYunwuOpenAIChat({
                systemPrompt: REPORT_PROMPT,
                messages: reportMessages,
                temperature: 0.7,
                model: GPT_5_4_MODEL,
                maxTokens: MAX_REPORT_OUTPUT_TOKENS,
                onUsage: async (usage) => {
                    await recordAiUsageEvent({
                        userId: authUser.id,
                        userEmail: authUser.email,
                        userNickname: authUser.nickname,
                        userGroup: authUser.groupName,
                        billingAudience: authUser.billingAudience === 'internal' ? 'internal' : 'external',
                        appId: 'main',
                        channel: REPORT_USAGE_CHANNEL,
                        providerId: 'yunwu-openai',
                        model: GPT_5_4_MODEL,
                        requestId: usageRequestId,
                        usage,
                        usageSource: 'response',
                        groupMultiplier: Number(process.env.YUNWU_OPENAI_CHAT_GROUP_MULTIPLIER) || 1,
                        usdCnyRate: Number(process.env.USAGE_MONITOR_USD_CNY_RATE) || 7.3,
                    });
                },
            });
        } finally {
            if (creditsReserved) {
                await releaseAiUsageCredits({
                    userId: authUser.id,
                    channel: REPORT_USAGE_CHANNEL,
                    requestId: usageRequestId,
                }).catch((error) => {
                    console.error('[credit-reservation] Failed to release report reservation:', error);
                });
            }
        }
        if (!text) {
            return NextResponse.json({ error: 'AI 返回为空' }, { status: 500 });
        }

        // Parse the JSON response
        let report;
        try {
            report = JSON.parse(text);
        } catch {
            // Try to extract JSON from mixed content
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                report = JSON.parse(jsonMatch[0]);
            } else {
                return NextResponse.json({ error: '报告解析失败' }, { status: 500 });
            }
        }

        return NextResponse.json({
            ...report,
            botId,
            botName: botName || 'AI助手',
            generatedAt: new Date().toISOString(),
            messageCount: messages.length,
        });
    } catch (err) {
        console.error('[Report] Error:', err);
        return errorResponse(err);
    }
}
