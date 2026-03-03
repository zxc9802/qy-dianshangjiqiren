import { randomUUID } from 'crypto';
import { gunzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import { WebSocket, type RawData } from 'ws';

const VOICE_API_URL = process.env.VOICE_API_URL ?? 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
const VOICE_APP_KEY = process.env.VOICE_APP_KEY ?? '6961943535';
const VOICE_ACCESS_KEY = process.env.VOICE_ACCESS_KEY ?? 's2X2lUR2XZ83Oy-9eJ0w0uR1wclw4VPv';
const VOICE_RESOURCE_ID = process.env.VOICE_RESOURCE_ID ?? 'volc.bigasr.sauc.duration';

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

const AUDIO_CHUNK_BYTES = 640; // 20ms for 16k / 16bit / mono PCM.
const AUDIO_SEND_INTERVAL_MS = 20;

interface ParsedWave {
    pcmData: Buffer;
    sampleRate: number;
    bitsPerSample: number;
    channels: number;
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const audio = formData.get('audio');

        if (!(audio instanceof File)) {
            return NextResponse.json({ error: 'Missing audio file' }, { status: 400 });
        }

        const uploadedBuffer = Buffer.from(await audio.arrayBuffer());
        const { pcmData, sampleRate, bitsPerSample, channels } = normalizeAudioToPcm(uploadedBuffer, audio.name);

        if (sampleRate !== 16000 || bitsPerSample !== 16 || channels !== 1) {
            return NextResponse.json(
                { error: `WAV format must be 16kHz / 16bit / mono, got ${sampleRate}Hz / ${bitsPerSample}bit / ${channels}ch` },
                { status: 400 },
            );
        }

        const { text, debugLogs } = await transcribeWithByteDance(pcmData);
        return NextResponse.json({ text, debug: debugLogs });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Voice transcription failed';
        console.error('Voice API error:', message);
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

function transcribeWithByteDance(audioData: Buffer): Promise<{ text: string; debugLogs: string[] }> {
    return new Promise((resolve, reject) => {
        const connectId = randomUUID();
        const debugLogs: string[] = [];
        const requestConfig = {
            user: {
                uid: 'web-voice-input',
            },
            audio: {
                format: 'pcm',
                rate: 16000,
                bits: 16,
                channel: 1,
            },
            request: {
                model_name: 'bigmodel',
                show_utterances: true,
            },
        };

        let fullText = '';
        let settled = false;

        debugLogs.push(`Audio PCM size: ${audioData.length} bytes`);

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
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
            resolve({ text: resultText.trim(), debugLogs });
        };

        const timeout = setTimeout(() => {
            debugLogs.push('Timeout reached (30s)');
            finalize(fullText);
        }, 30000);

        ws.on('open', () => {
            debugLogs.push('WebSocket opened, sending config packet...');
            ws.send(encodeFullClientRequest(requestConfig));

            void streamAudio(ws, audioData, debugLogs).catch((err) => {
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
                const headerHex = buf.subarray(0, Math.min(20, buf.length)).toString('hex');
                const msgType = buf.length >= 2 ? (buf[1] >> 4) : -1;
                const msgFlags = buf.length >= 2 ? (buf[1] & 0x0f) : -1;
                const compression = buf.length >= 3 ? (buf[2] & 0x0f) : -1;
                debugLogs.push(`RawFrame: len=${buf.length}, type=${msgType}, flags=${msgFlags}, comp=${compression}, hex=${headerHex}`);

                const message = parseServerPayload(buf);
                if (!message || typeof message !== 'object') {
                    debugLogs.push(`Parsed null/non-object, skipping`);
                    return;
                }

                debugLogs.push(`ParsedJSON: ${JSON.stringify(message).slice(0, 300)}`);

                const text = extractText(message);
                if (text) {
                    fullText = text;
                }

                const eventName = extractEventName(message);
                debugLogs.push(`Event: ${eventName}, text: ${text || '(none)'}`);

                if (isFinalMessage(message)) {
                    finalize(fullText);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'unknown';
                debugLogs.push(`Failed to parse message: ${message}`);
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
            debugLogs.push(`WebSocket closed. fullText: "${fullText.slice(0, 120)}"`);
            if (!settled) {
                finalize(fullText);
            }
        });
    });
}

async function streamAudio(ws: WebSocket, audioData: Buffer, debugLogs: string[]) {
    debugLogs.push(`Streaming PCM in ${AUDIO_CHUNK_BYTES}-byte packets...`);
    for (let offset = 0; offset < audioData.length; offset += AUDIO_CHUNK_BYTES) {
        const chunk = audioData.subarray(offset, Math.min(offset + AUDIO_CHUNK_BYTES, audioData.length));
        ws.send(encodeAudioOnlyRequest(chunk));
        await delay(AUDIO_SEND_INTERVAL_MS);
    }

    debugLogs.push('Sending final negative packet');
    ws.send(encodeAudioOnlyRequest(Buffer.alloc(0), NEG_WITHOUT_SEQUENCE));
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

    // Detect sequence from flags: POS_SEQUENCE(1), NEG_SEQUENCE(2), NEG_WITH_SEQUENCE(3) all have sequence
    const hasSequence = messageTypeFlags > 0;
    const messageDescriptionLength = messageType === SERVER_ERROR_RESPONSE ? 8 : 4;
    const sequenceLength = hasSequence ? 4 : 0;
    const payloadOffset = headerSize * 4 + messageDescriptionLength + sequenceLength;

    if (payloadOffset > frame.length) {
        // Try without sequence as fallback
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

    const text = payload.toString('utf-8');
    try {
        return JSON.parse(text);
    } catch {
        // Not valid JSON - might be a binary ACK frame, skip it
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
