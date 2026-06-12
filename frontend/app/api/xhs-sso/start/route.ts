import { NextRequest } from 'next/server';
import { getAuthUser, errorResponse } from '@/app/lib/auth';
import {
    buildXhsSsoUrl,
    createXhsSsoTicket,
    parseXhsRedirectPath,
} from '@/app/lib/xhs-sso';

async function readRequestBody(req: NextRequest): Promise<unknown> {
    try {
        return await req.json();
    } catch {
        return {};
    }
}

export async function POST(req: NextRequest) {
    try {
        const user = await getAuthUser(req);
        const body = await readRequestBody(req) as { redirectPath?: unknown };
        const redirectPath = parseXhsRedirectPath(body.redirectPath);
        const ticket = await createXhsSsoTicket(user.id, redirectPath);
        const mainAppUrl = req.nextUrl.origin;

        return Response.json({
            url: buildXhsSsoUrl(ticket.id, { mainAppUrl, redirectPath }),
            expiresAt: ticket.expiresAt,
        });
    } catch (error) {
        return errorResponse(error);
    }
}
