import { NextRequest } from 'next/server';
import { errorResponse, getAuthUser } from '@/app/lib/auth';
import {
    createSsoClientPreflightResponse,
    jsonWithSsoClientCors,
    withSsoClientCors,
} from '@/app/lib/sso-client-cors';

function serializeSsoUser(user: {
    id: string;
    email: string;
    nickname: string;
    groupName: string;
    avatar: string;
    role: string;
    createdAt: Date;
}) {
    return {
        id: user.id,
        account: user.email,
        nickname: user.nickname,
        groupName: user.groupName,
        avatar: user.avatar,
        role: user.role,
        createdAt: user.createdAt,
    };
}

export async function GET(req: NextRequest) {
    const origin = req.headers.get('origin');

    try {
        const user = await getAuthUser(req);

        return jsonWithSsoClientCors({
            success: true,
            data: {
                user: serializeSsoUser(user),
            },
        }, undefined, origin);
    } catch (error) {
        return withSsoClientCors(errorResponse(error), origin);
    }
}

export function OPTIONS(req: NextRequest) {
    return createSsoClientPreflightResponse(req);
}
