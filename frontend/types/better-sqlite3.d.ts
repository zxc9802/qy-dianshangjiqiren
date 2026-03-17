declare module 'better-sqlite3' {
    interface Statement<Row = unknown> {
        run(...params: unknown[]): unknown;
        get(...params: unknown[]): Row | undefined;
        all(...params: unknown[]): Row[];
    }

    export default class Database {
        constructor(filename: string, options?: Record<string, unknown>);
        pragma(source: string): unknown;
        exec(source: string): this;
        prepare<Row = unknown>(source: string): Statement<Row>;
    }
}
