import { randomUUID } from 'crypto';
import { gunzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import { WebSocket, type RawData } from 'ws';
import { readServerEnv } from '../../lib/server-env';

const VOICE_API_URL = readServerEnv('VOICE_API_URL')?.trim() || 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
const VOICE_APP_KEY = readServerEnv('VOICE_APP_KEY')?.trim() || '';
const VOICE_ACCESS_KEY = readServerEnv('VOICE_ACCESS_KEY')?.trim() || '';
const VOICE_RESOURCE_ID = readServerEnv('VOICE_RESOURCE_ID')?.trim() || 'volc.bigasr.sauc.duration';

// Protocol constants from ByteDance speech SDK.
const PROTOCOL_VERSION = 0b0001;
const DEFAULT_HEADER_SIZE = 0b0001;
const CLIENT_FULL_REQUEST = 0b0001;
const CLIENT_AUDIO_ONLY_REQUEST = 0b0010;
const SERVER_ERROR_RESPONSE = 0b1111;
const NO_SEQUENCE = 0b0000;
const NEG_WITHOUT_SEQUENCE = 0b0010;
const JSON_SERIALIZATION = 0b0001;
const NO_COMPRESSION = 0b0000;
const GZIP_COMPRESSION = 0b0001;

const PCM_SAMPLE_RATE = 16000;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_CHANNELS = 1;
const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * (PCM_BITS_PER_SAMPLE / 8) * PCM_CHANNELS;
const AUDIO_CHUNK_BYTES = 32 * 1024;
const MAX_WS_BUFFERED_BYTES = 256 * 1024;
const WS_BACKPRESSURE_WAIT_MS = 5;
const MIN_TIMEOUT_MS = 20_000;
const EXTRA_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 90_000;

interface ParsedWave {
    pcmData: Buffer;
    sampleRate: number;
    bitsPerSample: number;
    channels: number;
}

interface TranscriptionDiagnostics {
    audioDurationMs: number;
    timeoutMs: number;
    chunkBytes: number;
    chunksSent: number;
    websocketConnectMs: number;
    sendDurationMs: number;
    resultWaitMs: number;
    totalDurationMs: number;
    finalEvent: string;
}

export async function POST(req: NextRequest) {
    const startedAt = Date.now();

    try {
        if (!VOICE_APP_KEY || !VOICE_ACCESS_KEY) {
            return NextResponse.json({ error: 'Voice service is not configured.' }, { status: 500 });
        }

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

        const parseStartedAt = Date.now();
        const { pcmData, sampleRate, bitsPerSample, channels } = normalizeAudioToPcm(uploadedBuffer, audio.name);
        const parseDurationMs = Date.now() - parseStartedAt;

        if (sampleRate !== PCM_SAMPLE_RATE || bitsPerSample !== PCM_BITS_PER_SAMPLE || channels !== PCM_CHANNELS) {
            return NextResponse.json(
                {
                    error: `WAV format must be ${PCM_SAMPLE_RATE / 1000}kHz / ${PCM_BITS_PER_SAMPLE}bit / ${PCM_CHANNELS}ch, got ${sampleRate}Hz / ${bitsPerSample}bit / ${channels}ch`,
                },
                { status: 400 },
            );
        }

        const transcriptionStartedAt = Date.now();
        const { text, diagnostics } = await transcribeWithByteDance(pcmData);
        const transcriptionDurationMs = Date.now() - transcriptionStartedAt;

        console.info('[voice] transcription completed', {
            requestDurationMs: Date.now() - startedAt,
            formDataDurationMs,
            bufferReadDurationMs,
            parseDurationMs,
            transcriptionDurationMs,
            uploadedBytes: uploadedBuffer.length,
            pcmBytes: pcmData.length,
            ...diagnostics,
        });

        return NextResponse.json({ text });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Voice transcription failed';
        console.error('[voice] transcription failed', {
            message,
            totalDurationMs: Date.now() - startedAt,
        });
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

function normalizeAudioToPcm(audioData: Buffer, fileName: string): ParsedWave {
    if (!isWave(audioData)) {
        throw new Error(`Unsupported audio format for "${fileName}". Please upload WAV (16k/16bit/mono).`);
    }

    return parseWavePcm(audioData);
}

function isWave(audioData: Buffer): boolean {
    return (
        audioData.length >= 12 &&
        audioData.toString('ascii', 0, 4) === 'RIFF' &&
        audioData.toString('ascii', 8, 12) === 'WAVE'
    );
}

function parseWavePcm(audioData: Buffer): ParsedWave {
    let offset = 12;

    let sampleRate = 0;
    let bitsPerSample = 0;
    let channels = 0;
    let isPcm = false;

    let dataOffset = -1;
    let dataSize = 0;

    while (offset + 8 <= audioData.length) {
        const chunkId = audioData.toString('ascii', offset, offset + 4);
        const chunkSize = audioData.readUInt32LE(offset + 4);
        const chunkDataStart = offset + 8;
        const nextChunkOffset = chunkDataStart + chunkSize + (chunkSize % 2);

        if (nextChunkOffset > audioData.length) {
            break;
        }

        if (chunkId === 'fmt ' && chunkSize >= 16) {
            const audioFormat = audioData.readUInt16LE(chunkDataStart);
            channels = audioData.readUInt16LE(chunkDataStart + 2);
            sampleRate = audioData.readUInt32LE(chunkDataStart + 4);
            bitsPerSample = audioData.readUInt16LE(chunkDataStart + 14);
            isPcm = audioFormat === 1;
        } else if (chunkId === 'data') {
            dataOffset = chunkDataStart;
            dataSize = chunkSize;
        }

        offset = nextChunkOffset;
    }

    if (!isPcm) {
        throw new Error('WAV audio format is not PCM.');
    }
    if (dataOffset < 0 || dataSize <= 0) {
        throw new Error('WAV data chunk not found.');
    }

    return {
        pcmData: audioData.subarray(dataOffset, dataOffset + dataSize),
        sampleRate,
        bitsPerSample,
        channels,
    };
}

function transcribeWithByteDance(audioData: Buffer): Promise<{ text: string; diagnostics: TranscriptionDiagnostics }> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const connectId = randomUUID();
        const audioDurationMs = Math.ceil((audioData.length / PCM_BYTES_PER_SECOND) * 1000);
        const timeoutMs = calculateTimeoutMs(audioDurationMs);
        const requestConfig = {
            user: {
                uid: 'web-voice-input',
            },
            audio: {
                format: 'pcm',
                rate: PCM_SAMPLE_RATE,
                bits: PCM_BITS_PER_SAMPLE,
                channel: PCM_CHANNELS,
            },
            request: {
                model_name: 'bigmodel',
                show_utterances: true,
            },
        };

        let fullText = '';
        let settled = false;
        let chunksSent = 0;
        let websocketOpenedAt = 0;
        let streamCompletedAt = 0;
        let finalEvent = 'socket_closed';

        const ws = new WebSocket(VOICE_API_URL, {
            headers: {
                'X-Api-App-Key': VOICE_APP_KEY,
                'X-Api-Access-Key': VOICE_ACCESS_KEY,
                'X-Api-Resource-Id': VOICE_RESOURCE_ID,
                'X-Api-Connect-Id': connectId,
            },
        });

        const finalize = (resultText: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);

            const finishedAt = Date.now();
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }

            resolve({
                text: resultText.trim(),
                diagnostics: {
                    audioDurationMs,
                    timeoutMs,
                    chunkBytes: AUDIO_CHUNK_BYTES,
                    chunksSent,
                    websocketConnectMs: websocketOpenedAt ? websocketOpenedAt - startedAt : 0,
                    sendDurationMs: websocketOpenedAt && streamCompletedAt ? streamCompletedAt - websocketOpenedAt : 0,
                    resultWaitMs: streamCompletedAt ? finishedAt - streamCompletedAt : finishedAt - startedAt,
                    totalDurationMs: finishedAt - startedAt,
                    finalEvent,
                },
            });
        };

        const timeout = setTimeout(() => {
            finalEvent = 'timeout';
            finalize(fullText);
        }, timeoutMs);

        ws.on('open', () => {
            websocketOpenedAt = Date.now();
            ws.send(encodeFullClientRequest(requestConfig));

            void streamAudio(ws, audioData)
                .then((result) => {
                    chunksSent = result.chunksSent;
                    streamCompletedAt = Date.now();
                })
                .catch((err) => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timeout);
                        reject(err instanceof Error ? err : new Error('Audio streaming failed'));
                    }
                });
        });

        ws.on('message', (raw: RawData) => {
            try {
                const buf = toBuffer(raw);
                const message = parseServerPayload(buf);
                if (!message || typeof message !== 'object') {
                    return;
                }

                const text = extractText(message);
                if (text) {
                    fullText = text;
                }

                if (isFinalMessage(message)) {
                    finalEvent = extractEventName(message) || 'final';
                    finalize(fullText);
                }
            } catch {
                // Ignore malformed ACK/heartbeat frames from the upstream service.
            }
        });

        ws.on('error', (err: Error) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                reject(new Error(`WebSocket error: ${err.message}`));
            }
        });

        ws.on('close', () => {
            if (!settled) {
                finalize(fullText);
            }
        });
    });
}

async function streamAudio(ws: WebSocket, audioData: Buffer): Promise<{ chunksSent: number }> {
    let chunksSent = 0;

    for (let offset = 0; offset < audioData.length; offset += AUDIO_CHUNK_BYTES) {
        while (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
            await delay(WS_BACKPRESSURE_WAIT_MS);
        }

        if (ws.readyState !== WebSocket.OPEN) {
            throw new Error('Voice WebSocket closed before audio upload finished.');
        }

        const chunk = audioData.subarray(offset, Math.min(offset + AUDIO_CHUNK_BYTES, audioData.length));
        ws.send(encodeAudioOnlyRequest(chunk));
        chunksSent++;
    }

    while (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
        await delay(WS_BACKPRESSURE_WAIT_MS);
    }

    if (ws.readyState !== WebSocket.OPEN) {
        throw new Error('Voice WebSocket closed before final packet was sent.');
    }

    ws.send(encodeAudioOnlyRequest(Buffer.alloc(0), NEG_WITHOUT_SEQUENCE));
    return { chunksSent };
}

function calculateTimeoutMs(audioDurationMs: number): number {
    return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, audioDurationMs + EXTRA_TIMEOUT_MS));
}

function toBuffer(raw: RawData): Buffer {
    if (Buffer.isBuffer(raw)) return raw;
    if (Array.isArray(raw)) return Buffer.concat(raw);
    if (raw instanceof ArrayBuffer) return Buffer.from(raw);
    return Buffer.from(raw as Buffer);
}

function buildHeader(
    messageType: number,
    messageTypeSpecificFlags = NO_SEQUENCE,
    serialization = JSON_SERIALIZATION,
    compression = NO_COMPRESSION,
): Buffer {
    const header = Buffer.alloc(4);
    header[0] = (PROTOCOL_VERSION << 4) | DEFAULT_HEADER_SIZE;
    header[1] = (messageType << 4) | messageTypeSpecificFlags;
    header[2] = (serialization << 4) | compression;
    header[3] = 0x00;
    return header;
}

function encodeFullClientRequest(requestConfig: object): Buffer {
    const payload = Buffer.from(JSON.stringify(requestConfig), 'utf-8');
    const header = buildHeader(CLIENT_FULL_REQUEST);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length, 0);
    return Buffer.concat([header, length, payload]);
}

function encodeAudioOnlyRequest(audioChunk: Buffer, flags = NO_SEQUENCE): Buffer {
    const header = buildHeader(CLIENT_AUDIO_ONLY_REQUEST, flags);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(audioChunk.length, 0);
    return Buffer.concat([header, length, audioChunk]);
}

function parseServerPayload(frame: Buffer): unknown {
    if (frame.length < 8) {
        throw new Error('Frame too short.');
    }

    const headerSize = frame[0] & 0x0f;
    const messageType = frame[1] >> 4;
    const messageTypeFlags = frame[1] & 0x0f;
    const compressionType = frame[2] & 0x0f;

    const hasSequence = messageTypeFlags > 0;
    const messageDescriptionLength = messageType === SERVER_ERROR_RESPONSE ? 8 : 4;
    const sequenceLength = hasSequence ? 4 : 0;
    const payloadOffset = headerSize * 4 + messageDescriptionLength + sequenceLength;

    if (payloadOffset > frame.length) {
        const fallbackOffset = headerSize * 4 + messageDescriptionLength;
        if (fallbackOffset <= frame.length) {
            let payload = frame.subarray(fallbackOffset);
            if (compressionType === GZIP_COMPRESSION && payload.length > 0) {
                payload = gunzipSync(payload);
            }
            if (payload.length === 0) return null;
            try {
                return JSON.parse(payload.toString('utf-8'));
            } catch {
                return null;
            }
        }
        return null;
    }

    let payload = frame.subarray(payloadOffset);
    if (compressionType === GZIP_COMPRESSION && payload.length > 0) {
        payload = gunzipSync(payload);
    }

    if (payload.length === 0) {
        return null;
    }

    try {
        return JSON.parse(payload.toString('utf-8'));
    } catch {
        return null;
    }
}

function extractEventName(message: object): string {
    const record = message as Record<string, unknown>;
    const event = record.event;
    if (typeof event === 'string') return event;
    const header = record.header;
    if (header && typeof header === 'object') {
        const name = (header as Record<string, unknown>).name;
        if (typeof name === 'string') return name;
    }
    return 'unknown';
}

function extractText(message: object): string {
    const record = message as Record<string, unknown>;

    const direct = record.result;
    if (typeof direct === 'string') return direct;

    if (direct && typeof direct === 'object') {
        const text = (direct as Record<string, unknown>).text;
        if (typeof text === 'string') return text;
    }

    if (Array.isArray(direct) && direct.length > 0 && typeof direct[0] === 'object' && direct[0] !== null) {
        const firstText = (direct[0] as Record<string, unknown>).text;
        if (typeof firstText === 'string') return firstText;
    }

    const payload = record.payload;
    if (payload && typeof payload === 'object') {
        const payloadResult = (payload as Record<string, unknown>).result;
        if (typeof payloadResult === 'string') return payloadResult;
        if (payloadResult && typeof payloadResult === 'object') {
            const payloadText = (payloadResult as Record<string, unknown>).text;
            if (typeof payloadText === 'string') return payloadText;
        }
    }

    return '';
}

function isFinalMessage(message: object): boolean {
    const record = message as Record<string, unknown>;

    const finalFlags = [
        record.is_final,
        record.final,
        record.finished,
        (record.result as Record<string, unknown> | undefined)?.is_final,
        (record.result as Record<string, unknown> | undefined)?.final,
    ];

    if (finalFlags.some(flag => flag === true)) {
        return true;
    }

    const eventName = extractEventName(message).toLowerCase();
    if (eventName.includes('complete') || eventName.includes('finished') || eventName.includes('end')) {
        return true;
    }

    return false;
}

function delay(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}
