import { NextRequest, NextResponse } from 'next/server';
import { WebSocket } from 'ws';

const VOICE_API_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
const VOICE_APP_KEY = '6961943535';
const VOICE_ACCESS_KEY = 's2X2lUR2XZ83Oy-9eJ0w0uR1wclw4VPv';
const VOICE_RESOURCE_ID = 'volc.bigasr.sauc.duration';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const audio = formData.get('audio') as File;

        if (!audio) {
            return NextResponse.json({ error: '未收到音频数据' }, { status: 400 });
        }

        const audioBuffer = Buffer.from(await audio.arrayBuffer());

        const text = await transcribeWithByteDance(audioBuffer);

        return NextResponse.json({ text });
    } catch (err) {
        const msg = err instanceof Error ? err.message : '语音识别失败';
        console.error('Voice API error:', msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

function transcribeWithByteDance(audioData: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
        const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const connectPayload = {
            header: {
                appkey: VOICE_APP_KEY,
                token: VOICE_ACCESS_KEY,
                namespace: 'SpeechService',
                name: 'StartTranscription',
                message_id: reqId,
            },
            payload: {
                resource_id: VOICE_RESOURCE_ID,
                format: 'wav',
                sample_rate: 16000,
                enable_punctuation: true,
                language: 'zh-CN',
            },
        };

        let fullText = '';
        let resolved = false;

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                ws.close();
                resolve(fullText || '');
            }
        }, 30000);

        const ws = new WebSocket(VOICE_API_URL);

        ws.on('open', () => {
            // Send connect request
            ws.send(JSON.stringify(connectPayload));

            // Send audio data in chunks
            const chunkSize = 3200; // 100ms of 16kHz 16-bit mono
            let offset = 0;

            const sendChunk = () => {
                if (offset >= audioData.length) {
                    // Send end signal
                    ws.send(JSON.stringify({
                        header: {
                            appkey: VOICE_APP_KEY,
                            namespace: 'SpeechService',
                            name: 'StopTranscription',
                            message_id: reqId,
                        },
                    }));
                    return;
                }

                const chunk = audioData.subarray(offset, offset + chunkSize);
                ws.send(chunk);
                offset += chunkSize;

                setTimeout(sendChunk, 100);
            };

            setTimeout(sendChunk, 200);
        });

        ws.on('message', (data: Buffer) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.payload?.result) {
                    fullText = msg.payload.result;
                }
                if (msg.header?.name === 'TranscriptionCompleted' ||
                    msg.header?.name === 'SentenceEnd') {
                    if (msg.payload?.result) {
                        fullText = msg.payload.result;
                    }
                }
                if (msg.header?.name === 'TranscriptionCompleted') {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        ws.close();
                        resolve(fullText);
                    }
                }
            } catch { /* ignore non-JSON */ }
        });

        ws.on('error', (err: Error) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                reject(new Error(`WebSocket error: ${err.message}`));
            }
        });

        ws.on('close', () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(fullText);
            }
        });
    });
}
