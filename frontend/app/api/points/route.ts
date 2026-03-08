import { AppError, errorResponse } from '../../lib/auth';

function disabledResponse() {
    throw new AppError('Points system is disabled.', 410);
}

export async function GET() {
    try {
        disabledResponse();
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST() {
    try {
        disabledResponse();
    } catch (error) {
        return errorResponse(error);
    }
}
