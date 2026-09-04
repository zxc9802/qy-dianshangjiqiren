import { NextRequest } from 'next/server';
import { AppError, errorResponse, getAuthUser } from '@/app/lib/auth';
import {
    buildExternalSsoCallbackUrl,
    createExternalSsoTicket,
    parseExternalSsoProduct,
    parseExternalSsoRedirectPath,
    parseExternalSsoState,
} from '@/app/lib/external-sso';

async function readRequestBody(req: NextRequest): Promise<unknown> {
    try {
        return await req.json();
    } catch {
        return {};
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ product: string }> },
) {
    try {
        const product = parseExternalSsoProduct((await params).product);
        const user = await getAuthUser(req);
        const body = await readRequestBody(req) as { redirectPath?: unknown; state?: unknown };
        const state = parseExternalSsoState(body.state);
        if (product === 'shuziren' && !state) {
            throw new AppError('SSO state is required.', 400, 'EXTERNAL_SSO_STATE_REQUIRED');
        }
        const ticket = await createExternalSsoTicket(
            product,
            user.id,
            parseExternalSsoRedirectPath(body.redirectPath),
        );

        return Response.json({
            url: buildExternalSsoCallbackUrl(product, ticket.id, state),
            expiresAt: ticket.expiresAt,
        });
    } catch (error) {
        return errorResponse(error);
    }
}
