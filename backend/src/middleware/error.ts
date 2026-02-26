import { Request, Response, NextFunction } from 'express';
import { pinoLogger } from '../utils/logger';

export class AppError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
        super(message);
        this.statusCode = statusCode;
    }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
    pinoLogger.error(err);

    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
        });
    }

    return res.status(500).json({
        success: false,
        message: '服务器内部错误',
    });
}
