const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

function parseEnvText(text) {
  const result = {};
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

function loadFallbackEnv() {
  const merged = {};
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '..', 'backend', '.env'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    Object.assign(merged, parseEnvText(fs.readFileSync(filePath, 'utf8')));
  }

  return merged;
}

const fallbackEnv = loadFallbackEnv();

function readEnv(key) {
  return process.env[key] || fallbackEnv[key];
}

async function main() {
  const databaseUrl = readEnv('DATABASE_URL');
  const adminAccount = readEnv('ADMIN_ACCOUNT');
  const adminPassword = readEnv('ADMIN_PASSWORD');
  const adminNickname = readEnv('ADMIN_NICKNAME') || adminAccount;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured.');
  }
  if (!adminAccount || !adminPassword) {
    throw new Error('ADMIN_ACCOUNT or ADMIN_PASSWORD is not configured.');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    keepAlive: true,
    max: 5,
  });

  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const existing = await prisma.user.findUnique({
      where: { email: adminAccount },
      select: { id: true, email: true },
    });

    let user;
    if (existing) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          role: 'admin',
          isVerified: true,
          nickname: adminNickname,
        },
        select: {
          id: true,
          email: true,
          role: true,
          nickname: true,
        },
      });
      console.log(`Updated admin user: ${user.email}`);
    } else {
      user = await prisma.user.create({
        data: {
          email: adminAccount,
          passwordHash,
          role: 'admin',
          isVerified: true,
          nickname: adminNickname,
        },
        select: {
          id: true,
          email: true,
          role: true,
          nickname: true,
        },
      });
      console.log(`Created admin user: ${user.email}`);
    }

    console.log(JSON.stringify(user, null, 2));
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
