import type { ExtensionSessionData, LocalPageSession } from './types';

export const DEFAULT_SITE_BASE_URL = (import.meta.env.VITE_SITE_BASE_URL || '').trim();
export const SITE_BASE_URL_KEY = 'siteBaseUrl';
export const AUTH_TOKEN_KEY = 'extensionAuthToken';
export const SESSION_DATA_KEY = 'extensionSessionData';

export async function getSiteBaseUrl(): Promise<string> {
  const result = await chrome.storage.local.get(SITE_BASE_URL_KEY);
  return typeof result[SITE_BASE_URL_KEY] === 'string'
    ? result[SITE_BASE_URL_KEY]
    : DEFAULT_SITE_BASE_URL;
}

export async function setSiteBaseUrl(siteBaseUrl: string): Promise<void> {
  await chrome.storage.local.set({ [SITE_BASE_URL_KEY]: siteBaseUrl });
}

export async function getAuthToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(AUTH_TOKEN_KEY);
  return typeof result[AUTH_TOKEN_KEY] === 'string' ? result[AUTH_TOKEN_KEY] : null;
}

export async function setAuthToken(token: string | null): Promise<void> {
  if (token) {
    await chrome.storage.local.set({ [AUTH_TOKEN_KEY]: token });
    return;
  }
  await chrome.storage.local.remove(AUTH_TOKEN_KEY);
}

export async function getSessionData(): Promise<ExtensionSessionData | null> {
  const result = await chrome.storage.local.get(SESSION_DATA_KEY);
  return result[SESSION_DATA_KEY] ?? null;
}

export async function setSessionData(session: ExtensionSessionData | null): Promise<void> {
  if (session) {
    await chrome.storage.local.set({ [SESSION_DATA_KEY]: session });
    return;
  }
  await chrome.storage.local.remove(SESSION_DATA_KEY);
}

export async function clearStoredAuth(): Promise<void> {
  await chrome.storage.local.remove([AUTH_TOKEN_KEY, SESSION_DATA_KEY]);
}

export function makePageSessionKey(tabId: number, url: string): string {
  return `pageSession:${tabId}:${encodeURIComponent(url)}`;
}

export async function getPageSession(tabId: number, url: string): Promise<LocalPageSession | null> {
  const key = makePageSessionKey(tabId, url);
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

export async function setPageSession(session: LocalPageSession): Promise<void> {
  await chrome.storage.local.set({ [session.sessionKey]: session });
}

