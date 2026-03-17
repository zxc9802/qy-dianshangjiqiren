import { errorResponse, getAuthUser } from '@/app/lib/auth';
import { ENGINE_CAPABILITIES } from '@/app/lib/video-bot/engines';
import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
    try {
        await getAuthUser(req);
        return Response.json(ENGINE_CAPABILITIES);
    } catch (error) {
        return errorResponse(error);
    }
}
