const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const prismaSchemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');

const packageJson = fs.readFileSync(packageJsonPath, 'utf8');
const prismaSchema = fs.readFileSync(prismaSchemaPath, 'utf8');

assert.equal(
    packageJson.includes('--accept-data-loss'),
    false,
    'Backend scripts must never run Prisma with --accept-data-loss.',
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

console.log('backend schema safety checks passed');
