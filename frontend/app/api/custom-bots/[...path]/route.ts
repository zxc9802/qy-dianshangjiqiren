import { NextRequest } from 'next/server';
import { proxyCustomBotRequest } from '../proxy';

async function readPathSegments(context: { params: Promise<{ path: string[] }> }): Promise<string[]> {
    const { path } = await context.params;
    return Array.isArray(path) ? path : [];
}

export async function GET(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return proxyCustomBotRequest(req, await readPathSegments(context));
}

export async function POST(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return proxyCustomBotRequest(req, await readPathSegments(context));
}

export async function PUT(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return proxyCustomBotRequest(req, await readPathSegments(context));
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    return proxyCustomBotRequest(req, await readPathSegments(context));
}
