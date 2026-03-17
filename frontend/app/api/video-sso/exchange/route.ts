import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, errorResponse } from '@/app/lib/auth';
import {
    consumeVideoSsoTicket,
    getVideoSsoSecretHeaderName,
    isValidVideoSsoInternalSecret,
} from '@/app/lib/video-sso';

const exchangeSchema = z.object({
    ticket: z.string().trim().min(1, 'SSO ticket is required.'),
});

export async function POST(req: NextRequest) {
    try {
        const secretHeaderName = getVideoSsoSecretHeaderName();
        if (!isValidVideoSsoInternalSecret(req.headers.get(secretHeaderName))) {
            throw new AppError('Forbidden.', 403, 'VIDEO_SSO_FORBIDDEN');
        }

        const data = exchangeSchema.parse(await req.json());
        const result = await consumeVideoSsoTicket(data.ticket);

        return Response.json({
            success: true,
            data: result,
        });
    } catch (error) {
        return errorResponse(error);
    }
}
