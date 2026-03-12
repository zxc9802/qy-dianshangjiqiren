import { NextRequest } from 'next/server';
import { proxyVideoGenerationRequest } from '../proxy';

export async function POST(req: NextRequest) {
    return proxyVideoGenerationRequest(req, ['generate']);
}
