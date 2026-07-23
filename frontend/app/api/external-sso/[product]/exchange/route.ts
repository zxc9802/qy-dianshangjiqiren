import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, errorResponse, signToken } from '@/app/lib/auth';
import {
    consumeExternalSsoTicket,
    getExternalSsoClientSecretHeaderName,
    isValidExternalSsoClientSecret,
    parseExternalSsoProduct,
} from '@/app/lib/external-sso';

const exchangeSchema = z.object({
    ticket: z.string().trim().min(1, 'SSO ticket is required.'),
});

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ product: string }> },
) {
    try {
        const product = parseExternalSsoProduct((await params).product);
        if (!isValidExternalSsoClientSecret(product, req.headers.get(getExternalSsoClientSecretHeaderName()))) {
            throw new AppError('SSO client authentication failed.', 401, 'EXTERNAL_SSO_CLIENT_UNAUTHORIZED');
        }

        const { ticket } = exchangeSchema.parse(await req.json());
        const result = await consumeExternalSsoTicket(product, ticket);

        return Response.json({
            success: true,
            data: {
                ...result,
                token: signToken(result.user.id, result.user.authTokenVersion, '5m'),
            },
        });
    } catch (error) {
        return errorResponse(error);
    }
}
