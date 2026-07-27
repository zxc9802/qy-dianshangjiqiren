export function isRetryableTransactionError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    if ('code' in error && (error.code === 'P2002' || error.code === 'P2034')) {
        return true;
    }

    if (!('name' in error) || error.name !== 'DriverAdapterError' || !('cause' in error)) {
        return false;
    }

    const cause = error.cause;
    return Boolean(
        cause
        && typeof cause === 'object'
        && 'kind' in cause
        && cause.kind === 'TransactionWriteConflict',
    );
}

export async function waitForTransactionRetry(attempt: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
}
