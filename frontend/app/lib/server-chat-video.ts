import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ChatAttachmentFrame, formatDuration } from './chat-attachments';
import { describeImageWithGemini } from './server-gemini-media';
import { transcribeWaveBuffer } from './server-voice-transcription';

const execFileAsync = promisify(execFile);

const TEMP_VIDEO_ROOT = path.join(process.cwd(), 'storage', 'chat-video-temp');
const PERSISTED_FRAME_ROOT = path.join(process.cwd(), 'public', 'chat-video-frames');
const TEMP_VIDEO_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_KEYFRAMES = 3;

interface TempVideoMeta {
    token: string;
    fileName: string;
    mimeType: string;
    createdAt: string;
    sourceFileName: string;
}

interface ExtractedFrameFile extends ChatAttachmentFrame {
    absolutePath: string;
}

export interface ProcessedVideoUpload {
    extractedText: string;
    transcript: string;
    durationMs?: number;
    previewUrl?: string;
    frames: ChatAttachmentFrame[];
    tempVideoToken: string;
}

export interface ProcessUploadedVideoOptions {
    includeFrameDescriptions?: boolean;
    includeTranscript?: boolean;
}

export interface TempVideoData {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    absolutePath: string;
}

export async function storeUploadedVideo(params: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
}): Promise<{ tempVideoToken: string }> {
    await cleanupStaleTempVideos();
    const temp = await createTempVideo(params.buffer, params.fileName, params.mimeType);
    return { tempVideoToken: temp.token };
}

export async function processUploadedVideo(params: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
}, options: ProcessUploadedVideoOptions = {}): Promise<ProcessedVideoUpload> {
    const {
        includeFrameDescriptions = true,
        includeTranscript = true,
    } = options;

    await cleanupStaleTempVideos();

    const temp = await createTempVideo(params.buffer, params.fileName, params.mimeType);
    let durationMs: number | undefined;
    let frames: ExtractedFrameFile[] = [];
    let transcript = '';
    let frameDescriptions: string[] = [];

    try {
        durationMs = await probeVideoDurationMs(temp.absolutePath).catch(() => undefined);
        if (includeFrameDescriptions) {
            frames = await extractKeyframes(temp.absolutePath, durationMs).catch(() => []);
            frameDescriptions = await describeFrames(frames).catch(() => []);
        }
        if (includeTranscript) {
            transcript = await extractTranscript(temp.absolutePath).catch(() => '');
        }

        return {
            extractedText: buildVideoExtractedText({
                fileName: params.fileName,
                durationMs,
                transcript: includeTranscript ? transcript : '',
                transcriptAttempted: includeTranscript,
                frameDescriptions,
            }),
            transcript: includeTranscript ? transcript : '',
            durationMs,
            previewUrl: frames[0]?.url,
            frames: frames.map((frame) => ({ url: frame.url, timestampMs: frame.timestampMs })),
            tempVideoToken: temp.token,
        };
    } catch (error) {
        await deleteTempVideo(temp.token);
        throw error;
    }
}

export async function loadTempVideo(token: string): Promise<TempVideoData> {
    const safeToken = sanitizeToken(token);
    const metaPath = path.join(TEMP_VIDEO_ROOT, safeToken, 'meta.json');
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as TempVideoMeta;
    const absolutePath = path.join(TEMP_VIDEO_ROOT, safeToken, meta.sourceFileName);
    const buffer = await fs.readFile(absolutePath);

    return {
        buffer,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        absolutePath,
    };
}

export async function deleteTempVideo(token: string): Promise<void> {
    const safeToken = sanitizeToken(token);
    await fs.rm(path.join(TEMP_VIDEO_ROOT, safeToken), { recursive: true, force: true }).catch(() => undefined);
}

export async function cleanupStaleTempVideos(ttlMs = TEMP_VIDEO_TTL_MS): Promise<void> {
    const now = Date.now();
    await fs.mkdir(TEMP_VIDEO_ROOT, { recursive: true });

    const entries = await fs.readdir(TEMP_VIDEO_ROOT, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map(async (entry) => {
        if (!entry.isDirectory()) {
            return;
        }

        const absolute = path.join(TEMP_VIDEO_ROOT, entry.name);
        try {
            const stat = await fs.stat(absolute);
            if (now - stat.mtimeMs > ttlMs) {
                await fs.rm(absolute, { recursive: true, force: true });
            }
        } catch {
            // Ignore cleanup errors.
        }
    }));
}

async function createTempVideo(buffer: Buffer, fileName: string, mimeType: string): Promise<{
    token: string;
    absolutePath: string;
}> {
    const token = `${Date.now()}-${randomUUID()}`;
    const extension = path.extname(fileName) || '.mp4';
    const directory = path.join(TEMP_VIDEO_ROOT, token);
    const sourceFileName = `source${extension.toLowerCase()}`;
    const absolutePath = path.join(directory, sourceFileName);

    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(absolutePath, buffer);

    const meta: TempVideoMeta = {
        token,
        fileName,
        mimeType,
        createdAt: new Date().toISOString(),
        sourceFileName,
    };
    await fs.writeFile(path.join(directory, 'meta.json'), JSON.stringify(meta), 'utf8');

    return { token, absolutePath };
}

async function probeVideoDurationMs(absolutePath: string): Promise<number> {
    const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        absolutePath,
    ]);

    const seconds = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('Unable to determine video duration.');
    }

    return Math.round(seconds * 1000);
}

async function extractKeyframes(absolutePath: string, durationMs?: number): Promise<ExtractedFrameFile[]> {
    await fs.mkdir(PERSISTED_FRAME_ROOT, { recursive: true });

    const timestamps = buildFrameTimestamps(durationMs);
    const token = `${Date.now()}-${randomUUID()}`;
    const results: ExtractedFrameFile[] = [];

    for (let index = 0; index < timestamps.length; index += 1) {
        const timestampMs = timestamps[index];
        const fileName = `${token}-${index + 1}.jpg`;
        const absoluteFramePath = path.join(PERSISTED_FRAME_ROOT, fileName);

        try {
            await execFileAsync('ffmpeg', [
                '-y',
                '-ss',
                String(Math.max(0, timestampMs / 1000)),
                '-i',
                absolutePath,
                '-frames:v',
                '1',
                '-vf',
                "scale='min(768,iw)':-2",
                '-q:v',
                '4',
                absoluteFramePath,
            ]);

            results.push({
                url: `/chat-video-frames/${fileName}`,
                timestampMs,
                absolutePath: absoluteFramePath,
            });
        } catch {
            // Skip frames that cannot be extracted.
        }
    }

    return results;
}

function buildFrameTimestamps(durationMs?: number): number[] {
    if (!durationMs || durationMs <= 0) {
        return [0, 1500, 3000];
    }

    const totalSeconds = durationMs / 1000;
    if (totalSeconds <= 6) {
        return [0, durationMs / 2, Math.max(durationMs - 500, 0)].map((value) => Math.round(value));
    }

    const points = [0.15, 0.5, 0.85];
    return points
        .slice(0, MAX_KEYFRAMES)
        .map((point) => Math.round(durationMs * point))
        .filter((value, index, list) => list.indexOf(value) === index);
}

async function describeFrames(frames: ExtractedFrameFile[]): Promise<string[]> {
    const descriptions: string[] = [];

    for (const frame of frames) {
        const buffer = await fs.readFile(frame.absolutePath);
        const base64 = buffer.toString('base64');
        const description = await describeImageWithGemini(
            base64,
            'image/jpeg',
            `请描述这个视频关键帧的主要画面和可见文字。当前帧时间点：${formatDuration(frame.timestampMs)}。`,
        );
        descriptions.push(`${formatDuration(frame.timestampMs)}：${description.trim()}`);
    }

    return descriptions;
}

async function extractTranscript(absolutePath: string): Promise<string> {
    const tempAudioPath = path.join(TEMP_VIDEO_ROOT, `${Date.now()}-${randomUUID()}.wav`);

    try {
        await execFileAsync('ffmpeg', [
            '-y',
            '-i',
            absolutePath,
            '-vn',
            '-acodec',
            'pcm_s16le',
            '-ar',
            '16000',
            '-ac',
            '1',
            tempAudioPath,
        ]);

        const audioBuffer = await fs.readFile(tempAudioPath);
        const { text } = await transcribeWaveBuffer(audioBuffer, path.basename(tempAudioPath));
        return text.trim();
    } finally {
        await fs.rm(tempAudioPath, { force: true }).catch(() => undefined);
    }
}

function buildVideoExtractedText(params: {
    fileName: string;
    durationMs?: number;
    transcript: string;
    transcriptAttempted: boolean;
    frameDescriptions: string[];
}): string {
    const sections = [`视频文件：${params.fileName}`];

    if (typeof params.durationMs === 'number' && params.durationMs > 0) {
        sections.push(`视频时长：${formatDuration(params.durationMs)}`);
    }

    if (params.transcriptAttempted) {
        if (params.transcript.trim()) {
            sections.push(`语音转写：\n${params.transcript.trim()}`);
        } else {
            sections.push('语音转写：未提取到可用语音，或视频无明显对白。');
        }
    }

    if (params.frameDescriptions.length > 0) {
        sections.push(`关键帧观察：\n${params.frameDescriptions.map((item, index) => `${index + 1}. ${item}`).join('\n')}`);
    }

    return sections.join('\n\n');
}

function sanitizeToken(token: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(token)) {
        throw new Error('Invalid temp video token.');
    }

    return token;
}
