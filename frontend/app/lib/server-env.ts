import fs from 'node:fs';
import path from 'node:path';

let cachedEnv: Record<string, string> | null = null;

function parseEnvText(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;

        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (key) result[key] = value;
    }

    return result;
}

function loadFallbackEnv(): Record<string, string> {
    if (cachedEnv) return cachedEnv;

    const merged: Record<string, string> = {};
    const candidates = [
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), '.env.local'),
        path.resolve(process.cwd(), '..', 'backend', '.env'),
    ];

    for (const filePath of candidates) {
        if (!fs.existsSync(filePath)) continue;
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            Object.assign(merged, parseEnvText(content));
        } catch (error) {
            console.error(`Failed to read env file: ${filePath}`, error);
        }
    }

    cachedEnv = merged;
    return merged;
}

export function readServerEnv(key: string): string | undefined {
    return process.env[key] || loadFallbackEnv()[key];
}

export function readBackendUrl(): string {
    const fallbackEnv = loadFallbackEnv();
    const explicit = process.env.BACKEND_URL?.trim() || fallbackEnv.BACKEND_URL?.trim();
    if (explicit) {
        return explicit.replace(/\/+$/, '');
    }

    const protocol = process.env.BACKEND_PROTOCOL?.trim() || fallbackEnv.BACKEND_PROTOCOL?.trim() || 'http';
    const host = process.env.BACKEND_HOST?.trim() || fallbackEnv.BACKEND_HOST?.trim() || 'localhost';
    const port = process.env.BACKEND_PORT?.trim() || fallbackEnv.BACKEND_PORT?.trim() || fallbackEnv.PORT?.trim() || '3001';

    return `${protocol}://${host}:${port}`.replace(/\/+$/, '');
}

export function readRequiredServerEnv(key: string): string {
    const value = readServerEnv(key)?.trim();
    if (!value) {
        throw new Error(`${key} is not configured.`);
    }
    return value;
}

