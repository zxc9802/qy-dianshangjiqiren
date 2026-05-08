import { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, signToken } from '@/app/lib/auth';
import { consumeDetailImageAgentSsoTicket } from '@/app/lib/detail-image-agent-sso';

const exchangeSchema = z.object({
    ticket: z.string().trim().min(1, 'SSO ticket is required.'),
});

export async function POST(req: NextRequest) {
    try {
        const data = exchangeSchema.parse(await req.json());
        const result = await consumeDetailImageAgentSsoTicket(data.ticket);

        return Response.json({
            success: true,
            data: {
                ...result,
                token: signToken(result.user.id),
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}
