import type {
  ExtensionBot,
  ExtensionChatMessage,
  ExtensionImageGenerationItem,
  ExtensionSessionData,
  PageContext,
  PageInsightRecord,
} from './types';
import {
  clearStoredAuth,
  getAuthToken,
  getSiteBaseUrl,
  setSessionData,
  setSiteBaseUrl,
} from './storage';

interface StreamRequest {
  botId: string;
  mode: 'summary' | 'chat';
  messages: ExtensionChatMessage[];
  pageContext?: PageContext;
}

interface AuthorizedFetchOptions {
  clearAuthOnUnauthorized?: boolean;
  siteBaseUrl?: string;
}

interface FetchSessionOptions {
  clearAuthOnUnauthorized?: boolean;
  clearSessionOnFailure?: boolean;
  persistSession?: boolean;
  persistSiteBaseUrl?: boolean;
  siteBaseUrl?: string;
}

function normalizeSiteBaseUrl(siteBaseUrl: string): string {
  return new URL(siteBaseUrl).origin;
}

async function resolveSiteBaseUrl(siteBaseUrl?: string): Promise<string> {
  const raw = siteBaseUrl || await getSiteBaseUrl();
  return normalizeSiteBaseUrl(raw);
}

async function authorizedFetch(
  path: string,
  init: RequestInit = {},
  options: AuthorizedFetchOptions = {},
): Promise<Response> {
  const token = await getAuthToken();
  if (!token) {
    throw new Error('Login was not detected.');
  }

  const siteBaseUrl = await resolveSiteBaseUrl(options.siteBaseUrl);
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(new URL(path, siteBaseUrl), {
    ...init,
    headers,
  });

  if (response.status === 401 && options.clearAuthOnUnauthorized !== false) {
    await clearStoredAuth();
  }

  return response;
}

export async function fetchSession(options: FetchSessionOptions = {}): Promise<ExtensionSessionData | null> {
  const token = await getAuthToken();
  if (!token) {
    if (options.persistSession !== false) {
      await setSessionData(null);
    }
    return null;
  }

  const response = await authorizedFetch('/api/extension/session', {}, {
    clearAuthOnUnauthorized: options.clearAuthOnUnauthorized,
    siteBaseUrl: options.siteBaseUrl,
  });
  if (!response.ok) {
    if (options.clearSessionOnFailure !== false && options.persistSession !== false) {
      await setSessionData(null);
    }
    throw new Error(response.status === 401 ? 'Login expired.' : 'Failed to sync main-site session.');
  }

  const payload = await response.json();
  const session = payload.data as ExtensionSessionData;

  if (options.persistSession !== false) {
    await setSessionData(session);
  }

  if (options.persistSiteBaseUrl !== false && session.siteBaseUrl) {
    await setSiteBaseUrl(normalizeSiteBaseUrl(session.siteBaseUrl));
  }

  return session;
}

export async function fetchExtensionBots(): Promise<ExtensionBot[]> {
  const response = await authorizedFetch('/api/extension/bots');
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || 'Failed to load bots.');
  }

  return payload.data.bots as ExtensionBot[];
}

export async function streamExtensionChat(
  request: StreamRequest,
  onText: (text: string) => void,
): Promise<void> {
  const response = await authorizedFetch('/api/extension/chat', {
    method: 'POST',
    body: JSON.stringify(request),
  });

  if (!response.ok || !response.body) {
    const payload = await response.text().catch(() => '');
    throw new Error(payload || 'Chat request failed.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });

    const lines = pending.split('\n');
    pending = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      const event = JSON.parse(jsonStr);
      if (event.type === 'text' && typeof event.content === 'string') {
        onText(event.content);
      }
      if (event.type === 'error') {
        throw new Error(event.content || 'Chat failed.');
      }
    }

    if (done) break;
  }

  if (pending.trim().startsWith('data: ')) {
    try {
      const event = JSON.parse(pending.trim().slice(6));
      if (event.type === 'text' && typeof event.content === 'string') {
        onText(event.content);
      }
      if (event.type === 'error') {
        throw new Error(event.content || 'Chat failed.');
      }
    } catch {
      // Ignore trailing partial chunk.
    }
  }
}

export async function saveInsight(payload: {
  pageContext: PageContext;
  summary?: string;
  chatTranscript: ExtensionChatMessage[];
  botId: string;
  botKind: 'builtin' | 'custom';
  botName: string;
}): Promise<PageInsightRecord> {
  const response = await authorizedFetch('/api/extension/insights', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || result.message || 'Failed to save insight.');
  }

  return result.data as PageInsightRecord;
}

export async function generateExtensionImage(payload: {
  prompt: string;
  aspectRatio?: string;
  count?: number;
}): Promise<ExtensionImageGenerationItem> {
  const response = await authorizedFetch('/api/image-generations', {
    method: 'POST',
    body: JSON.stringify({
      prompt: payload.prompt,
      aspectRatio: payload.aspectRatio || '1:1',
      count: payload.count || 1,
    }),
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || result.message || 'Image generation failed.');
  }

  return result.data as ExtensionImageGenerationItem;
}
