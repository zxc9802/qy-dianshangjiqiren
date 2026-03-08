import { Router, Request, Response } from 'express';
import { AppError } from '../middleware/error';

const router = Router();

function disabled(): never {
    throw new AppError('Points system is disabled.', 410);
}

router.get('/balance', async (_req: Request, _res: Response) => {
    disabled();
});

router.get('/transactions', async (_req: Request, _res: Response) => {
    disabled();
});

router.post('/redeem', async (_req: Request, _res: Response) => {
    disabled();
});

router.post('/recharge', async (_req: Request, _res: Response) => {
    disabled();
});

export default router;
