import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { VideoBotTaskInputs, VideoBotTaskRecord, VideoBotTaskUpdate } from './types';

type SqliteDatabase = InstanceType<typeof Database>;

let db: SqliteDatabase | null = null;

function resolveDbPath(): string {
    return path.join(process.cwd(), 'data', 'videoforge.db');
}

function getDb(): SqliteDatabase {
    if (db) {
        return db;
    }

    const dbPath = resolveDbPath();
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            engine TEXT NOT NULL,
            mode TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            model TEXT,
            prompt TEXT,
            params TEXT,
            inputs TEXT,
            engineTaskId TEXT,
            videoUrl TEXT,
            error TEXT,
            pollError TEXT,
            createdAt TEXT NOT NULL,
            completedAt TEXT
        )
    `);

    const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'pollError')) {
        db.exec('ALTER TABLE tasks ADD COLUMN pollError TEXT');
    }

    return db;
}

type TaskRow = Omit<VideoBotTaskRecord, 'params' | 'inputs'> & {
    params: string | null;
    inputs: string | null;
};

function parseInputs(raw: string | null): VideoBotTaskInputs {
    if (!raw) return {};
    try {
        return JSON.parse(raw) as VideoBotTaskInputs;
    } catch {
        return {};
    }
}

function parseParams(raw: string | null): Record<string, unknown> {
    if (!raw) return {};
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function mapRow(row: TaskRow): VideoBotTaskRecord {
    return {
        ...row,
        params: parseParams(row.params),
        inputs: parseInputs(row.inputs),
    };
}

export function createTask(task: VideoBotTaskRecord): VideoBotTaskRecord {
    const database = getDb();
    database.prepare(`
        INSERT INTO tasks (
            id, userId, engine, mode, status, model, prompt, params, inputs, engineTaskId, videoUrl, error, pollError, createdAt, completedAt
        ) VALUES (
            @id, @userId, @engine, @mode, @status, @model, @prompt, @params, @inputs, @engineTaskId, @videoUrl, @error, @pollError, @createdAt, @completedAt
        )
    `).run({
        ...task,
        params: JSON.stringify(task.params ?? {}),
        inputs: JSON.stringify(task.inputs ?? {}),
        pollError: task.pollError ?? null,
    });

    return task;
}

export function getTask(id: string, userId: string): VideoBotTaskRecord | null {
    const row = getDb().prepare('SELECT * FROM tasks WHERE id = ? AND userId = ?').get(id, userId) as TaskRow | undefined;
    return row ? mapRow(row) : null;
}

export function getAllTasks(userId: string): VideoBotTaskRecord[] {
    const rows = getDb().prepare('SELECT * FROM tasks WHERE userId = ? ORDER BY createdAt DESC').all(userId) as TaskRow[];
    return rows.map(mapRow);
}

export function updateTask(id: string, updates: VideoBotTaskUpdate): void {
    const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
        return;
    }

    const sets = entries.map(([key]) => `${key} = ?`);
    const values = entries.map(([key, value]) => {
        if (key === 'inputs') {
            return JSON.stringify(value ?? {});
        }
        return value;
    });

    values.push(id);
    getDb().prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteTask(id: string, userId: string): void {
    getDb().prepare('DELETE FROM tasks WHERE id = ? AND userId = ?').run(id, userId);
}
