import { NextRequest } from 'next/server';
import { getUserId, AppError, errorResponse } from '../../../../../lib/auth';
import { getConversationImageJob } from '../../../../../lib/server-conversation-image-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
    try {
        const userId = await getUserId(_req);
        const { id, jobId } = await params;
        const job = getConversationImageJob({ jobId, conversationId: id, userId });

        if (!job) {
            throw new AppError('Image generation job not found', 404);
        }

        return Response.json({ success: true, data: job });
    } catch (error) {
        return errorResponse(error);
    }
}
