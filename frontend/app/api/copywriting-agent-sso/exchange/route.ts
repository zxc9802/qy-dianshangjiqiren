import { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, signToken } from '@/app/lib/auth';
import { consumeCopywritingAgentSsoTicket } from '@/app/lib/copywriting-agent-sso';
import {
    createSsoClientPreflightResponse,
    jsonWithSsoClientCors,
    withSsoClientCors,
} from '@/app/lib/sso-client-cors';

const exchangeSchema = z.object({
    ticket: z.string().trim().min(1, 'SSO ticket is required.'),
});

export async function POST(req: NextRequest) {
    const origin = req.headers.get('origin');

    try {
        const data = exchangeSchema.parse(await req.json());
        const result = await consumeCopywritingAgentSsoTicket(data.ticket);

        return jsonWithSsoClientCors({
            success: true,
            data: {
                ...result,
                token: signToken(result.user.id, result.user.authTokenVersion),
            },
        }, undefined, origin);
    } catch (error) {
        return withSsoClientCors(errorResponse(error), origin);
    }
}

export function OPTIONS(req: NextRequest) {
    return createSsoClientPreflightResponse(req);
}
