import type { ExtMessage, PageInfo } from '../shared/types';

// ─── Extract main page text ───────────────────────────────────────────────────
function extractPageText(): PageInfo {
  const title = document.title || '';
  const url = location.href;

  // Try semantic containers first
  const selectors = ['article', 'main', '[role="main"]', '.content', '#content', '#main'];
  let container: Element | null = null;
  for (const sel of selectors) {
    container = document.querySelector(sel);
    if (container) break;
  }
  const root = container ?? document.body;

  // Clone and strip scripts/styles/nav/footer
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script,style,nav,footer,header,[role="navigation"],[role="banner"]').forEach(el => el.remove());

  const raw = clone.innerText ?? clone.textContent ?? '';
  // Collapse whitespace and truncate
  const text = raw.replace(/\s{3,}/g, '\n\n').trim().slice(0, 6000);

  return { title, url, text };
}

// ─── Try to sync token from this page's localStorage (only on main site) ─────
function trySyncToken() {
  try {
    const token = localStorage.getItem('token');
    if (token) {
      chrome.storage.local.set({ token });
    }
  } catch { /* cross-origin pages won't have access */ }
}

// Run token sync on load
trySyncToken();

// ─── Listen for messages from background / popup ─────────────────────────────
chrome.runtime.onMessage.addListener((msg: ExtMessage, _sender, sendResponse) => {
  if (msg.type === 'GET_PAGE_INFO') {
    sendResponse(extractPageText());
    return true;
  }

  if (msg.type === 'GET_TOKEN') {
    trySyncToken();
    try {
      const token = localStorage.getItem('token');
      sendResponse({ token });
    } catch {
      sendResponse({ token: null });
    }
    return true;
  }
});
