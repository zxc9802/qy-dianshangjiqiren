import type { AdapterCreateResult, AdapterQueryResult, VideoBotStatus } from '../types';

export const YUNWU_BASE_URL = 'https://yunwu.ai';

export abstract class BaseAdapter {
    constructor(protected readonly apiKey: string) {}

    protected async httpPost<T>(pathname: string, body: unknown, init?: { headers?: Record<string, string>; timeoutMs?: number }): Promise<T> {
        return this.request<T>(pathname, {
            method: 'POST',
            body,
            headers: init?.headers,
            timeoutMs: init?.timeoutMs,
        });
    }

    protected async httpGet<T>(pathname: string, init?: { headers?: Record<string, string>; timeoutMs?: number }): Promise<T> {
        return this.request<T>(pathname, {
            method: 'GET',
            headers: init?.headers,
            timeoutMs: init?.timeoutMs,
        });
    }

    private async request<T>(
        pathname: string,
        options: {
            method: 'GET' | 'POST';
            body?: unknown;
            headers?: Record<string, string>;
            timeoutMs?: number;
        },
    ): Promise<T> {
        const controller = new AbortController();
        const timeoutMs = options.timeoutMs ?? 60_000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(new URL(pathname, YUNWU_BASE_URL), {
                method: options.method,
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    Accept: 'application/json',
                    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                    ...(options.headers ?? {}),
                },
                body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
                signal: controller.signal,
                cache: 'no-store',
            });

            const raw = await response.text();
            if (!response.ok) {
                throw new Error(`API error ${response.status}: ${raw}`);
            }

            if (!raw) {
                return {} as T;
            }

            try {
                return JSON.parse(raw) as T;
            } catch {
                throw new Error(`Invalid JSON response: ${raw.slice(0, 200)}`);
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`API timeout after ${timeoutMs}ms`);
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    protected normalizeStatus(engineStatus: string | null | undefined): VideoBotStatus {
        const status = (engineStatus ?? '').toLowerCase();
        if (['completed', 'succeed', 'succeeded', 'success', 'done'].includes(status)) return 'completed';
        if (['failed', 'error', 'failure', 'canceled', 'cancelled'].includes(status)) return 'failed';
        if (['processing', 'running', 'in_progress', 'preparing'].includes(status)) return 'processing';
        if (['pending', 'submitted', 'queuing', 'queueing', 'queued'].includes(status)) return 'queued';
        return 'queued';
    }

    abstract createTask(params: Record<string, unknown>): Promise<AdapterCreateResult>;
    abstract queryTask(engineTaskId: string, task?: { params?: Record<string, unknown>; inputs?: Record<string, unknown> }): Promise<AdapterQueryResult>;
}
