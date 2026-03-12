import { NextRequest, NextResponse } from 'next/server';
import {
    ensureVoiceServiceConfigured,
    transcribeWaveBuffer,
} from '../../lib/server-voice-transcription';

export async function POST(req: NextRequest) {
    const startedAt = Date.now();

    try {
        ensureVoiceServiceConfigured();

        const formDataStartedAt = Date.now();
        const formData = await req.formData();
        const formDataDurationMs = Date.now() - formDataStartedAt;
        const audio = formData.get('audio');

        if (!(audio instanceof File)) {
            return NextResponse.json({ error: 'Missing audio file' }, { status: 400 });
        }

        const bufferStartedAt = Date.now();
        const uploadedBuffer = Buffer.from(await audio.arrayBuffer());
        const bufferReadDurationMs = Date.now() - bufferStartedAt;

        const transcriptionStartedAt = Date.now();
        const { text, diagnostics } = await transcribeWaveBuffer(uploadedBuffer, audio.name);
        const transcriptionDurationMs = Date.now() - transcriptionStartedAt;

        console.info('[voice] transcription completed', {
            requestDurationMs: Date.now() - startedAt,
            formDataDurationMs,
            bufferReadDurationMs,
            transcriptionDurationMs,
            uploadedBytes: uploadedBuffer.length,
            ...diagnostics,
        });

        return NextResponse.json({ text });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Voice transcription failed';
        console.error('[voice] transcription failed', {
            message,
            totalDurationMs: Date.now() - startedAt,
        });
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
