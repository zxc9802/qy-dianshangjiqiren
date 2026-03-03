import { API_BASE } from '../shared/bots';
import type { ExtMessage, Message } from '../shared/types';

// ─── Helper: get stored token ────────────────────────────────────────────────
async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get('token');
  return result.token ?? null;
}

// ─── Helper: stream chat from API ────────────────────────────────────────────
async function streamChat(
  botId: string,
  messages: Message[],
  onChunk: (text: string) => void,
): Promise<void> {
  const token = await getToken();

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ botId, messages }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === 'text' && event.content) {
          onChunk(event.content as string);
        }
      } catch { /* ignore malformed lines */ }
    }
  }
}

// ─── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {

  // Popup asking for stored token
  if (msg.type === 'GET_TOKEN') {
    getToken().then(token => sendResponse({ token }));
    return true;
  }

  // Popup sending a chat request
  if (msg.type === 'CHAT') {
    const { botId, messages } = msg.payload;

    // Find the popup tab to send streaming chunks back to
    const sendChunk = (content: string) => {
      chrome.runtime.sendMessage({ type: 'CHAT_CHUNK', content } satisfies ExtMessage)
        .catch(() => { /* popup may have closed */ });
    };

    streamChat(botId, messages, sendChunk)
      .then(() => {
        chrome.runtime.sendMessage({ type: 'CHAT_DONE' } satisfies ExtMessage)
          .catch(() => {});
        sendResponse({ ok: true });
      })
      .catch(err => {
        chrome.runtime.sendMessage({
          type: 'CHAT_ERROR',
          error: err instanceof Error ? err.message : String(err),
        } satisfies ExtMessage).catch(() => {});
        sendResponse({ ok: false });
      });

    return true; // keep message channel open
  }
});

// ─── On install: try to read token from the main site ────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  // Will be populated when content script syncs the token
  console.log('[电商AI插件] 已安装');
});
