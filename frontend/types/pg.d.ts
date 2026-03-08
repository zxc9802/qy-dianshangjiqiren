declare module 'pg' {
    export class Pool {
        constructor(config?: Record<string, unknown>);
        on(event: string, listener: (...args: unknown[]) => void): this;
        end(): Promise<void>;
    }
}
