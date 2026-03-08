import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { readServerEnv } from './server-env';

interface PrismaGlobalState {
    prisma?: PrismaClient;
    prismaPool?: Pool;
}

const CONNECTION_RESET_PATTERNS = [
    /server has closed the connection/i,
    /connection terminated unexpectedly/i,
    /terminating connection/i,
    /connection ended unexpectedly/i,
    /econnreset/i,
];

function createPrismaClient(): { client: PrismaClient; pool: Pool } {
    const connectionString = readServerEnv('DATABASE_URL');
    if (!connectionString) {
        throw new Error('DATABASE_URL is required');
    }

    const pool = new Pool({
        connectionString,
        allowExitOnIdle: true,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        keepAlive: true,
        max: 10,
        maxUses: 7500,
    });

    pool.on('error', (error) => {
        console.error('[Prisma Pool] Idle client error', error);
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require('@prisma/adapter-pg') as {
        PrismaPg: new (pool: Pool, options?: {
            onConnectionError?: (error: Error) => void;
            onPoolError?: (error: Error) => void;
        }) => unknown;
    };

    const adapter = new PrismaPg(pool, {
        onConnectionError(error: Error) {
            console.error('[Prisma Adapter] Connection error', error);
        },
        onPoolError(error: Error) {
            console.error('[Prisma Adapter] Pool error', error);
        },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { client: new PrismaClient({ adapter: adapter as any }), pool };
}

const globalForPrisma = globalThis as unknown as PrismaGlobalState;

function getPrismaState(): PrismaGlobalState {
    if (!globalForPrisma.prisma || !globalForPrisma.prismaPool) {
        const { client, pool } = createPrismaClient();
        globalForPrisma.prisma = client;
        globalForPrisma.prismaPool = pool;
    }

    return globalForPrisma;
}

function getPrismaClient(): PrismaClient {
    return getPrismaState().prisma!;
}

function shouldReconnect(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return CONNECTION_RESET_PATTERNS.some((pattern) => pattern.test(message));
}

export async function resetPrismaClient(): Promise<void> {
    const currentClient = globalForPrisma.prisma;
    const currentPool = globalForPrisma.prismaPool;

    delete globalForPrisma.prisma;
    delete globalForPrisma.prismaPool;

    await currentClient?.$disconnect().catch(() => undefined);
    await currentPool?.end().catch(() => undefined);
}

export async function withPrismaRetry<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T> {
    try {
        return await operation(getPrismaClient());
    } catch (error) {
        if (!shouldReconnect(error)) {
            throw error;
        }

        console.warn('[Prisma] Connection dropped, recreating client and retrying once.');
        await resetPrismaClient();
        return operation(getPrismaClient());
    }
}

export const prisma = new Proxy({} as PrismaClient, {
    get(_target, property, receiver) {
        const client = getPrismaClient();
        const value = Reflect.get(client as object, property, receiver);
        return typeof value === 'function' ? value.bind(client) : value;
    },
});
