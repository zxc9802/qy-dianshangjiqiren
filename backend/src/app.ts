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
import imagePromptTagRoutes from './routes/imagePromptTags';
import workflowRoutes from './routes/workflow';
import workflowAiRoutes from './routes/workflow-ai';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/image-assets', express.static(path.join(process.cwd(), 'storage')));

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
app.use('/api/image-prompt-tags', imagePromptTagRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/workflow-ai', workflowAiRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
    pinoLogger.info(`Server running on port ${PORT}`);
});

export default app;
