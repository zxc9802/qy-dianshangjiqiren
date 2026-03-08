import { NextRequest } from 'next/server';
import { proxyGenerateImageRequest, proxyImageGenerationRequest } from './proxy';

export async function GET(req: NextRequest) {
    return proxyImageGenerationRequest(req);
}

export async function POST(req: NextRequest) {
    return proxyGenerateImageRequest(req);
}
