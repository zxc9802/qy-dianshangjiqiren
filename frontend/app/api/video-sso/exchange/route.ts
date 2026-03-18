import { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, signToken } from '@/app/lib/auth';
import {
    consumeVideoSsoTicket,
} from '@/app/lib/video-sso';
import {
    createVideoClientPreflightResponse,
    jsonWithVideoClientCors,
    withVideoClientCors,
} from '@/app/lib/video-site-cors';

const exchangeSchema = z.object({
    ticket: z.string().trim().min(1, 'SSO ticket is required.'),
});

export async function POST(req: NextRequest) {
    const origin = req.headers.get('origin');

    try {
        const data = exchangeSchema.parse(await req.json());
        const result = await consumeVideoSsoTicket(data.ticket);

        return jsonWithVideoClientCors({
            success: true,
            data: {
                ...result,
                token: signToken(result.user.id),
            },
        }, undefined, origin);
    } catch (error) {
        return withVideoClientCors(errorResponse(error), origin);
    }
}

export function OPTIONS(req: NextRequest) {
    return createVideoClientPreflightResponse(req);
}
