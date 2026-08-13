const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = process.cwd();
const binDir = path.join(projectRoot, 'bin');
const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
const ffmpegPath = path.join(binDir, ffmpegName);
const ffprobePath = path.join(binDir, ffprobeName);
const nextBinPath = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const bundledFfmpegPath = require('ffmpeg-static');
const bundledFfprobePath = require('ffprobe-static').path;

const env = { ...process.env };

function isEnabled(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function resolveMediaBinary(configuredPath, copiedPath, bundledPath, fallbackCommand) {
    const normalizedConfiguredPath = String(configuredPath || '').trim();
    const configuredPathIsFile = normalizedConfiguredPath
        && (path.isAbsolute(normalizedConfiguredPath) || normalizedConfiguredPath.includes('/') || normalizedConfiguredPath.includes('\\'));
    if (normalizedConfiguredPath && (!configuredPathIsFile || fs.existsSync(configuredPath))) {
        return normalizedConfiguredPath;
    }

    for (const candidatePath of [copiedPath, bundledPath]) {
        if (candidatePath && fs.existsSync(candidatePath)) {
            return candidatePath;
        }
    }

    return fallbackCommand;
}

if (fs.existsSync(binDir)) {
    env.PATH = env.PATH ? `${binDir}${path.delimiter}${env.PATH}` : binDir;
}

env.FFMPEG_PATH = resolveMediaBinary(env.FFMPEG_PATH, ffmpegPath, bundledFfmpegPath, ffmpegName);
env.FFPROBE_PATH = resolveMediaBinary(env.FFPROBE_PATH, ffprobePath, bundledFfprobePath, ffprobeName);

if (isEnabled(env.PRISMA_DB_PUSH_ON_START)) {
    const prismaResult = spawnSync('npx', ['prisma', 'db', 'push'], {
        stdio: 'inherit',
        shell: true,
        env,
    });

    if (prismaResult.error) {
        console.error('[start-production] prisma db push failed to start:', prismaResult.error.message);
        process.exit(1);
    }

    if (prismaResult.status !== 0) {
        console.error('[start-production] prisma db push failed; refusing to start with a mismatched schema.');
        process.exit(prismaResult.status ?? 1);
    }
} else {
    console.log('[start-production] Skipping prisma db push. Set PRISMA_DB_PUSH_ON_START=true to run a non-destructive schema sync explicitly.');
}

const useLocalNextBin = fs.existsSync(nextBinPath);
const nextProcess = spawn(
    useLocalNextBin ? process.execPath : 'next',
    useLocalNextBin ? [nextBinPath, 'start'] : ['start'],
    {
        stdio: 'inherit',
        shell: !useLocalNextBin,
        env,
    },
);

nextProcess.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});

nextProcess.on('error', (error) => {
    console.error('[start-production] failed to start Next.js:', error);
    process.exit(1);
});
