export interface LocalConversationVideoRecord {
    conversationScope: string;
    clientVideoId: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    createdAt: number;
    lastAccessedAt: number;
    orderIndex: number;
    extractedText: string;
    transcript: string;
    blob: Blob;
}

interface StoredConversationVideoRecord extends LocalConversationVideoRecord {
    storageKey: string;
}

const DB_NAME = 'conversation-video-cache';
const STORE_NAME = 'videos';
const DB_VERSION = 1;
const MAX_VIDEOS_PER_CONVERSATION = 10;

function getStorageKey(conversationScope: string, clientVideoId: string): string {
    return `${conversationScope}:${clientVideoId}`;
}

function withDatabase<T>(callback: (db: IDBDatabase) => Promise<T>): Promise<T> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is unavailable.'));
    }

    return new Promise<T>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            const store = db.objectStoreNames.contains(STORE_NAME)
                ? request.transaction?.objectStore(STORE_NAME)
                : db.createObjectStore(STORE_NAME, { keyPath: 'storageKey' });
            if (!store) {
                return;
            }

            if (!store.indexNames.contains('byConversationScope')) {
                store.createIndex('byConversationScope', 'conversationScope', { unique: false });
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

function normalizeRecord(record: StoredConversationVideoRecord): LocalConversationVideoRecord {
    return {
        conversationScope: record.conversationScope,
        clientVideoId: record.clientVideoId,
        fileName: record.fileName,
        mimeType: record.mimeType,
        fileSize: record.fileSize,
        createdAt: record.createdAt,
        lastAccessedAt: record.lastAccessedAt,
        orderIndex: record.orderIndex,
        extractedText: record.extractedText,
        transcript: record.transcript,
        blob: record.blob,
    };
}

async function readConversationRecords(
    store: IDBObjectStore,
    conversationScope: string,
): Promise<StoredConversationVideoRecord[]> {
    const index = store.index('byConversationScope');
    const request = index.getAll(IDBKeyRange.only(conversationScope));
    const records = await runRequest<StoredConversationVideoRecord[]>(request);
    return Array.isArray(records) ? records : [];
}

async function pruneConversationRecords(store: IDBObjectStore, conversationScope: string): Promise<void> {
    const records = await readConversationRecords(store, conversationScope);
    if (records.length <= MAX_VIDEOS_PER_CONVERSATION) {
        return;
    }

    const staleRecords = [...records]
        .sort((left, right) => {
            if (left.lastAccessedAt !== right.lastAccessedAt) {
                return left.lastAccessedAt - right.lastAccessedAt;
            }
            return left.createdAt - right.createdAt;
        })
        .slice(0, records.length - MAX_VIDEOS_PER_CONVERSATION);

    await Promise.all(staleRecords.map((record) => runRequest(store.delete(record.storageKey))));
}

export async function putLocalConversationVideo(record: LocalConversationVideoRecord): Promise<void> {
    await withDatabase(async (db) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const completion = waitForTransaction(transaction);
        const store = transaction.objectStore(STORE_NAME);
        const payload: StoredConversationVideoRecord = {
            ...record,
            storageKey: getStorageKey(record.conversationScope, record.clientVideoId),
        };

        await runRequest(store.put(payload));
        await pruneConversationRecords(store, record.conversationScope);
        await completion;
    });
}

export async function listLocalConversationVideos(conversationScope: string): Promise<LocalConversationVideoRecord[]> {
    return withDatabase(async (db) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const records = await readConversationRecords(store, conversationScope);
        return records
            .sort((left, right) => left.orderIndex - right.orderIndex || left.createdAt - right.createdAt)
            .map(normalizeRecord);
    });
}

export async function getLocalConversationVideo(
    conversationScope: string,
    clientVideoId: string,
): Promise<LocalConversationVideoRecord | null> {
    return withDatabase(async (db) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const completion = waitForTransaction(transaction);
        const store = transaction.objectStore(STORE_NAME);
        const storageKey = getStorageKey(conversationScope, clientVideoId);
        const record = await runRequest<StoredConversationVideoRecord | undefined>(store.get(storageKey));

        if (!record) {
            return null;
        }

        const touchedRecord: StoredConversationVideoRecord = {
            ...record,
            lastAccessedAt: Date.now(),
        };
        await runRequest(store.put(touchedRecord));
        await completion;
        return normalizeRecord(touchedRecord);
    });
}

export async function migrateConversationVideoScope(fromScope: string, toScope: string): Promise<void> {
    if (!fromScope || !toScope || fromScope === toScope) {
        return;
    }

    await withDatabase(async (db) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const completion = waitForTransaction(transaction);
        const store = transaction.objectStore(STORE_NAME);
        const records = await readConversationRecords(store, fromScope);

        for (const record of records) {
            const migratedRecord: StoredConversationVideoRecord = {
                ...record,
                conversationScope: toScope,
                storageKey: getStorageKey(toScope, record.clientVideoId),
            };
            await runRequest(store.put(migratedRecord));
            await runRequest(store.delete(record.storageKey));
        }

        await pruneConversationRecords(store, toScope);
        await completion;
    });
}
