import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

const PLACEHOLDER_DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

function parseEnvFile(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) {
        return {};
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const result: Record<string, string> = {};

    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex <= 0) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (key) {
            result[key] = value;
        }
    }

    return result;
}

function resolveDatabaseUrl(): string {
    if (process.env.DATABASE_URL?.trim()) {
        return process.env.DATABASE_URL;
    }
    const candidates = [
        path.resolve(__dirname, '.env'),
        path.resolve(__dirname, '.env.local'),
        path.resolve(__dirname, '..', 'backend', '.env'),
    ];

    for (const filePath of candidates) {
        const databaseUrl = parseEnvFile(filePath).DATABASE_URL;
        if (databaseUrl) {
            return databaseUrl;
        }
    }
    // prisma generate only needs a syntactically valid URL during build.
    return PLACEHOLDER_DATABASE_URL;
}

export default defineConfig({
    schema: path.join(__dirname, 'prisma', 'schema.prisma'),
    datasource: {
        url: resolveDatabaseUrl(),
    },
});
