import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const { PrismaPg } = require('@prisma/adapter-pg') as {
    PrismaPg: new (options: { connectionString: string }) => unknown;
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is required');
}

const adapter = new PrismaPg({ connectionString });
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter: adapter as any });

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}
