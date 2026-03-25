export interface LaunchChatDraftRecord {
    id: string;
    prompt: string;
    files: File[];
    createdAt: number;
}

const DB_NAME = 'chat-launch-drafts';
const STORE_NAME = 'drafts';
const DB_VERSION = 1;

function createDraftId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `launch-draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function withDatabase<T>(callback: (db: IDBDatabase) => Promise<T>): Promise<T> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is unavailable.'));
    }

    return new Promise<T>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };

        request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB.'));
        request.onsuccess = async () => {
            const db = request.result;
            try {
                resolve(await callback(db));
            } catch (error) {
                reject(error);
            } finally {
                db.close();
            }
        };
    });
}

function runRequest<T = void>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    });
}

export async function putLaunchChatDraft(params: {
    prompt: string;
    files: File[];
}): Promise<LaunchChatDraftRecord> {
    return withDatabase(async (db) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const completion = waitForTransaction(transaction);
        const store = transaction.objectStore(STORE_NAME);
        const record: LaunchChatDraftRecord = {
            id: createDraftId(),
            prompt: params.prompt,
            files: params.files,
            createdAt: Date.now(),
        };

        await runRequest(store.put(record));
        await completion;
        return record;
    });
}

export async function consumeLaunchChatDraft(id: string): Promise<LaunchChatDraftRecord | null> {
    if (!id.trim()) {
        return null;
    }

    return withDatabase(async (db) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const completion = waitForTransaction(transaction);
        const store = transaction.objectStore(STORE_NAME);
        const record = await runRequest<LaunchChatDraftRecord | undefined>(store.get(id));

        if (!record) {
            return null;
        }

        await runRequest(store.delete(id));
        await completion;
        return record;
    });
}
