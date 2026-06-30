import { randomUUID } from 'crypto';

export type ConversationImageJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ConversationImageJobResult {
    content: string;
    kind: 'image';
    imageUrls: string[];
    imagePrompt?: string;
    aspectRatio?: string;
}

export interface ConversationImageJobSnapshot {
    id: string;
    conversationId: string;
    userId: string;
    status: ConversationImageJobStatus;
    message: string;
    result?: ConversationImageJobResult;
    error?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
}

interface ConversationImageJobRecord extends ConversationImageJobSnapshot {
    runPromise?: Promise<void>;
}

interface StartConversationImageJobOptions {
    conversationId: string;
    userId: string;
    initialMessage?: string;
    run: (context: { jobId: string; updateStatus: (message: string) => void }) => Promise<ConversationImageJobResult>;
}

const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_JOBS = 200;

const globalWithJobs = globalThis as typeof globalThis & {
    __conversationImageJobs?: Map<string, ConversationImageJobRecord>;
};

const imageJobs = globalWithJobs.__conversationImageJobs || new Map<string, ConversationImageJobRecord>();
globalWithJobs.__conversationImageJobs = imageJobs;

function nowIso(): string {
    return new Date().toISOString();
}

function copyJob(job: ConversationImageJobRecord): ConversationImageJobSnapshot {
    return {
        id: job.id,
        conversationId: job.conversationId,
        userId: job.userId,
        status: job.status,
        message: job.message,
        result: job.result
            ? {
                ...job.result,
                imageUrls: [...job.result.imageUrls],
            }
            : undefined,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
    };
}

function cleanupJobs() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [jobId, job] of imageJobs.entries()) {
        if (Date.parse(job.updatedAt) < cutoff) {
            imageJobs.delete(jobId);
        }
    }

    while (imageJobs.size > MAX_JOBS) {
        const oldest = [...imageJobs.values()]
            .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))[0];
        if (!oldest) return;
        imageJobs.delete(oldest.id);
    }
}

function updateJob(job: ConversationImageJobRecord, patch: Partial<ConversationImageJobRecord>) {
    Object.assign(job, patch, { updatedAt: nowIso() });
}

export function startConversationImageJob(options: StartConversationImageJobOptions): ConversationImageJobSnapshot {
    cleanupJobs();

    const timestamp = nowIso();
    const job: ConversationImageJobRecord = {
        id: randomUUID(),
        conversationId: options.conversationId,
        userId: options.userId,
        status: 'queued',
        message: options.initialMessage || '图片生成任务已创建。',
        createdAt: timestamp,
        updatedAt: timestamp,
    };

    imageJobs.set(job.id, job);

    job.runPromise = Promise.resolve()
        .then(async () => {
            updateJob(job, { status: 'running', message: options.initialMessage || '正在生成图片。' });
            const result = await options.run({
                jobId: job.id,
                updateStatus: (message) => {
                    updateJob(job, { status: 'running', message });
                },
            });
            updateJob(job, {
                status: 'succeeded',
                message: '图片已生成。',
                result,
                completedAt: nowIso(),
            });
        })
        .catch((error) => {
            updateJob(job, {
                status: 'failed',
                message: '图片生成失败。',
                error: error instanceof Error ? error.message : String(error),
                completedAt: nowIso(),
            });
        });

    return copyJob(job);
}

export function getConversationImageJob({
    jobId,
    conversationId,
    userId,
}: {
    jobId: string;
    conversationId: string;
    userId: string;
}): ConversationImageJobSnapshot | null {
    cleanupJobs();

    const job = imageJobs.get(jobId);
    if (!job || job.conversationId !== conversationId || job.userId !== userId) {
        return null;
    }

    return copyJob(job);
}
