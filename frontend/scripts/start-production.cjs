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

const env = { ...process.env };

if (fs.existsSync(binDir)) {
    env.PATH = env.PATH ? `${binDir}${path.delimiter}${env.PATH}` : binDir;
}

if (!env.FFMPEG_PATH && fs.existsSync(ffmpegPath)) {
    env.FFMPEG_PATH = ffmpegPath;
}

if (!env.FFPROBE_PATH && fs.existsSync(ffprobePath)) {
    env.FFPROBE_PATH = ffprobePath;
}

const prismaResult = spawnSync('npx', ['prisma', 'db', 'push', '--accept-data-loss'], {
    stdio: 'inherit',
    shell: true,
    env,
});

if (prismaResult.error) {
    console.warn('[start-production] prisma db push failed to start:', prismaResult.error.message);
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
