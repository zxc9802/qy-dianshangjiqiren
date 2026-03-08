import { NextRequest } from 'next/server';
import { proxyImageGenerationRequest } from '../proxy';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return proxyImageGenerationRequest(req, [id]);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return proxyImageGenerationRequest(req, [id]);
}
