import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { pinoLogger } from './utils/logger';
import { errorHandler } from './middleware/error';
import authRoutes from './routes/auth';
import botRoutes from './routes/bots';
import conversationRoutes from './routes/conversations';
import pointsRoutes from './routes/points';
import imageGenerationRoutes from './routes/imageGenerations';
import videoGenerationRoutes from './routes/videoGenerations';
import imagePromptTagRoutes from './routes/imagePromptTags';
import workflowRoutes from './routes/workflow';
import workflowAiRoutes from './routes/workflow-ai';
import customBotRoutes from './routes/custom-bots';

const app = express();
const PORT = process.env.PORT || 3001;
const IMAGE_ASSET_CACHE_MAX_AGE = '365d';

function getAllowedOrigins(): string[] {
    const configured = [process.env.FRONTEND_URL, process.env.FRONTEND_URLS]
        .filter(Boolean)
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim())
        .filter(Boolean);

    if (configured.length > 0) {
        return Array.from(new Set(configured));
    }

    if (process.env.NODE_ENV !== 'production') {
        return ['http://localhost:3000'];
    }

    return [];
}

const allowedOrigins = getAllowedOrigins();

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('Origin not allowed by CORS.'));
    },
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/image-assets', express.static(path.join(process.cwd(), 'storage'), {
    maxAge: IMAGE_ASSET_CACHE_MAX_AGE,
    immutable: true,
}));
app.use('/api/bot-avatars', express.static(path.join(process.cwd(), 'uploads', 'bot-avatars'), {
    maxAge: IMAGE_ASSET_CACHE_MAX_AGE,
    immutable: true,
}));

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/bots', botRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/points', pointsRoutes);
app.use('/api/image-generations', imageGenerationRoutes);
app.use('/api/video-generations', videoGenerationRoutes);
app.use('/api/image-prompt-tags', imagePromptTagRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/workflow-ai', workflowAiRoutes);
app.use('/api/custom-bots', customBotRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
    pinoLogger.info(`Server running on port ${PORT}`);
});

export default app;
