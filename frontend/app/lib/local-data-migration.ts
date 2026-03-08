import { api, LocalConversationItem, LocalWorkflowItem } from './api';

const LEGACY_CONVERSATIONS_KEY = 'conversations';
const LEGACY_FAVORITES_KEY = 'favorites';
const LEGACY_WORKFLOWS_KEY = 'custom_workflows';
const MIGRATION_VERSION = 'v1';

function readList<T>(key: string): T[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function getMigrationMarkerKey(userId: string): string {
    return `cloud_migrated_${userId}_${MIGRATION_VERSION}`;
}

function cleanupLegacyKeys() {
    localStorage.removeItem(LEGACY_CONVERSATIONS_KEY);
    localStorage.removeItem(LEGACY_FAVORITES_KEY);
    localStorage.removeItem(LEGACY_WORKFLOWS_KEY);
}

export async function runLocalDataMigration(userId: string): Promise<void> {
    if (typeof window === 'undefined' || !userId) return;

    const markerKey = getMigrationMarkerKey(userId);
    if (localStorage.getItem(markerKey) === '1') return;

    const conversations = readList<LocalConversationItem>(LEGACY_CONVERSATIONS_KEY);
    const favorites = readList<LocalConversationItem>(LEGACY_FAVORITES_KEY);
    const workflows = readList<LocalWorkflowItem>(LEGACY_WORKFLOWS_KEY);

    await api.migrateLocalData({ conversations, favorites, workflows });
    localStorage.setItem(markerKey, '1');
    cleanupLegacyKeys();
}
