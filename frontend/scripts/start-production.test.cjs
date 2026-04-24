const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, 'start-production.cjs');
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const prismaSchemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const source = fs.readFileSync(scriptPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const prismaSchema = fs.readFileSync(prismaSchemaPath, 'utf8');

assert.equal(
    source.includes('--accept-data-loss'),
    false,
    'Production startup must never run Prisma with --accept-data-loss.',
);

assert.equal(
    source.includes('PRISMA_DB_PUSH_ON_START'),
    true,
    'Prisma db push on startup must be gated by PRISMA_DB_PUSH_ON_START.',
);

assert.equal(
    prismaSchema.includes('@@map("video_usage_logs")'),
    true,
    'Shared production schema must preserve the video_usage_logs table.',
);

assert.equal(
    prismaSchema.includes('@@map("model_pricing")'),
    true,
    'Shared production schema must preserve the model_pricing table.',
);

assert.equal(
    typeof manifest.engines?.npm,
    'string',
    'Frontend package.json must pin an npm engine so Zeabur does not run npm update -g npm.',
);

console.log('start-production safety checks passed');
