import { NextRequest } from 'next/server';
import { getAuthUser, errorResponse } from '@/app/lib/auth';
import { buildVideoSsoUrl, createVideoSsoTicket, parseVideoRedirectPath } from '@/app/lib/video-sso';
import { parseVideoSiteKey } from '@/app/lib/video-sites';

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
        const body = await readRequestBody(req) as { redirectPath?: unknown; site?: unknown };
        const site = parseVideoSiteKey(body.site);
        const ticket = await createVideoSsoTicket(user.id, parseVideoRedirectPath(body.redirectPath));
        const mainAppUrl = req.nextUrl.origin;

        return Response.json({
            url: buildVideoSsoUrl(ticket.id, { mainAppUrl, site }),
            expiresAt: ticket.expiresAt,
        });
    } catch (error) {
        return errorResponse(error);
    }
}
