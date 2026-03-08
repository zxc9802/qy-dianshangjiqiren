import { fetchSession } from './api';
import type { PageContext } from './types';
import { getAuthToken, getSiteBaseUrl, setAuthToken } from './storage';

interface ContentProbeResult {
  ok?: boolean;
  origin?: string;
  href?: string;
  tokenPresent?: boolean;
}

export interface AuthSyncDiagnostic {
  siteBaseUrl: string;
  siteOrigin: string | null;
  matchedTabCount: number;
  reachableTabCount: number;
  tokenTabCount: number;
  synced: boolean;
  sampleTabUrl: string | null;
}

function isInjectableUrl(url?: string): boolean {
  if (!url) return false;
  return /^(https?):\/\//.test(url);
}

function getOriginFromUrl(url?: string): string | null {
  if (!url) return null;

  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function getCandidateTabs(preferredOrigin: string | null): Promise<{
  matchedTabs: chrome.tabs.Tab[];
  orderedTabs: chrome.tabs.Tab[];
}> {
  const allTabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  const matchedTabs: chrome.tabs.Tab[] = [];
  const fallbackTabs: chrome.tabs.Tab[] = [];

  for (const tab of allTabs) {
    const tabOrigin = getOriginFromUrl(tab.url);
    if (preferredOrigin && tabOrigin === preferredOrigin) {
      matchedTabs.push(tab);
    } else {
      fallbackTabs.push(tab);
    }
  }

  return {
    matchedTabs,
    orderedTabs: [...matchedTabs, ...fallbackTabs],
  };
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isInjectableUrl(tab.url)) return false;

    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'PING_EXTENSION_CONTENT' });
      if (response?.ok) return true;
    } catch {
      // The content script is likely missing from an already-open tab. Inject it below.
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });

    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING_EXTENSION_CONTENT' });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function trySyncFromTab(tabId: number, authState: ContentProbeResult): Promise<boolean> {
  if (!authState.tokenPresent || !authState.origin) {
    return false;
  }

  const previousToken = await getAuthToken();
  let synced = false;

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'SYNC_AUTH_STATE' }) as ContentProbeResult;
    if (!response?.ok) {
      return false;
    }

    const session = await fetchSession({
      clearAuthOnUnauthorized: false,
      clearSessionOnFailure: false,
      persistSession: true,
      persistSiteBaseUrl: true,
      siteBaseUrl: authState.origin,
    });
    synced = Boolean(session);
    return synced;
  } catch {
    return false;
  } finally {
    if (!synced) {
      await setAuthToken(previousToken);
    }
  }
}

export async function getPageContext(tabId?: number): Promise<PageContext | null> {
  const activeTab = typeof tabId === 'number' ? { id: tabId } : await getActiveTab();
  if (!activeTab?.id) return null;

  try {
    const ready = await ensureContentScript(activeTab.id);
    if (!ready) return null;
    return await chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_CONTEXT' });
  } catch {
    return null;
  }
}

export async function openMainSite(path = '/'): Promise<void> {
  const siteBaseUrl = await getSiteBaseUrl();
  const url = new URL(path, siteBaseUrl);
  await chrome.tabs.create({ url: url.toString() });
}

export async function syncAuthFromMainSiteTabs(): Promise<boolean> {
  const result = await inspectAuthSyncState();
  return result.synced;
}

export async function inspectAuthSyncState(): Promise<AuthSyncDiagnostic> {
  try {
    const siteBaseUrl = await getSiteBaseUrl();
    const siteOrigin = getOriginFromUrl(siteBaseUrl);
    const { matchedTabs, orderedTabs } = await getCandidateTabs(siteOrigin);
    let reachableTabCount = 0;
    let tokenTabCount = 0;
    let synced = false;
    let sampleTabUrl: string | null = null;
    const inspectedTabIds = new Set<number>();

    for (const tab of orderedTabs) {
      if (typeof tab.id !== 'number' || inspectedTabIds.has(tab.id)) {
        continue;
      }
      inspectedTabIds.add(tab.id);
      sampleTabUrl ||= tab.url || null;

      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        continue;
      }
      reachableTabCount += 1;

      try {
        const authState = await chrome.tabs.sendMessage(tab.id, { type: 'GET_AUTH_STATE' }) as ContentProbeResult;
        if (authState?.tokenPresent) {
          tokenTabCount += 1;
          if (await trySyncFromTab(tab.id, authState)) {
            synced = true;
            sampleTabUrl = authState.href || tab.url || sampleTabUrl;
            break;
          }
        }
      } catch {
        continue;
      }
    }

    return {
      siteBaseUrl,
      siteOrigin,
      matchedTabCount: matchedTabs.length,
      reachableTabCount,
      tokenTabCount,
      synced,
      sampleTabUrl,
    };
  } catch {
    return {
      siteBaseUrl: '',
      siteOrigin: null,
      matchedTabCount: 0,
      reachableTabCount: 0,
      tokenTabCount: 0,
      synced: false,
      sampleTabUrl: null,
    };
  }
}

export async function openSidePanel(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
}
