import { NextRequest } from 'next/server';
import { proxyCustomBotRequest } from './proxy';

export async function GET(req: NextRequest) {
    return proxyCustomBotRequest(req, []);
}

export async function POST(req: NextRequest) {
    return proxyCustomBotRequest(req, []);
}
