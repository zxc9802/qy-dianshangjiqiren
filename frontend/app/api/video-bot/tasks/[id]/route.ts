import { AppError, errorResponse, getAuthUser } from '@/app/lib/auth';
import { deleteTask, getTask, updateTask } from '@/app/lib/video-bot/db';
import { getAdapter } from '@/app/lib/video-bot/engines';
import type { VideoBotTaskRecord, VideoBotTaskUpdate } from '@/app/lib/video-bot/types';
import { NextRequest } from 'next/server';

function mergeInputs(task: VideoBotTaskRecord, nextInputs?: Record<string, unknown>) {
    if (!nextInputs) {
        return undefined;
    }

    return {
        ...task.inputs,
        ...nextInputs,
    };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const user = await getAuthUser(req);
        const { id } = await context.params;
        const task = getTask(id, user.id);
        if (!task) {
            throw new AppError('任务不存在。', 404);
        }

        const apiKey = req.headers.get('x-api-key')?.trim() || req.nextUrl.searchParams.get('apiKey')?.trim() || '';
        if (apiKey && task.engineTaskId && task.status !== 'failed' && (task.status !== 'completed' || !task.videoUrl)) {
            try {
                const adapter = getAdapter(task.engine, apiKey);
                const result = await adapter.queryTask(task.engineTaskId, task);
                const nextInputs = mergeInputs(task, result.inputs as Record<string, unknown> | undefined);

                const updates: VideoBotTaskUpdate = {
                    status: result.videoUrl ? 'completed' : result.status,
                    videoUrl: result.videoUrl ?? task.videoUrl ?? null,
                    engineTaskId: result.engineTaskId ?? task.engineTaskId ?? null,
                    model: result.model ?? task.model ?? null,
                    inputs: nextInputs,
                    error: result.status === 'failed' ? result.error ?? '任务执行失败。' : null,
                    pollError: null,
                    completedAt: result.videoUrl ? new Date().toISOString() : task.completedAt ?? null,
                };

                updateTask(task.id, updates);
                return Response.json({
                    ...task,
                    ...updates,
                    inputs: nextInputs ?? task.inputs,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : '轮询任务状态失败。';
                updateTask(task.id, { pollError: message });
                return Response.json({
                    ...task,
                    pollError: message,
                });
            }
        }

        return Response.json(task);
    } catch (error) {
        return errorResponse(error);
    }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const user = await getAuthUser(req);
        const { id } = await context.params;
        const task = getTask(id, user.id);
        if (!task) {
            throw new AppError('任务不存在。', 404);
        }

        deleteTask(id, user.id);
        return Response.json({ success: true });
    } catch (error) {
        return errorResponse(error);
    }
}
