import { NextRequest } from 'next/server';
import { proxyVideoGenerationFormRequest } from '../proxy';

export async function POST(req: NextRequest) {
    return proxyVideoGenerationFormRequest(req, 'generate');
}
