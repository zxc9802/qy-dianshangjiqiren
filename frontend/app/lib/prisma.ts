import { PrismaClient } from '@prisma/client';
import { readServerEnv } from './server-env';

function createPrismaClient(): PrismaClient {
    const connectionString = readServerEnv('DATABASE_URL');
    if (!connectionString) {
        throw new Error('DATABASE_URL is required');
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require('@prisma/adapter-pg') as {
        PrismaPg: new (options: { connectionString: string }) => unknown;
    };

    const adapter = new PrismaPg({ connectionString });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new PrismaClient({ adapter: adapter as any });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}
