import { NextRequest } from 'next/server';
import { proxyVideoGenerationRequest } from '../proxy';

export async function GET(req: NextRequest) {
    return proxyVideoGenerationRequest(req, 'status');
}
