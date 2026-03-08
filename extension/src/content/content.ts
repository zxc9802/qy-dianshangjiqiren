import type { PageContext } from '../shared/types';

const DEFAULT_SITE_BASE_URL = (import.meta.env.VITE_SITE_BASE_URL || '').trim();
const SITE_BASE_URL_KEY = 'siteBaseUrl';
const AUTH_TOKEN_KEY = 'extensionAuthToken';
const SESSION_DATA_KEY = 'extensionSessionData';

const AUTH_BRIDGE_EVENT = 'ecommerce-ai-extension-auth';
const CAPTION_SELECTORS = [
  '.ytp-caption-segment',
  '.bpx-player-subtitle-panel-text',
  '.bpx-player-subtitle-item-text',
  '[class*="caption"]',
  '[class*="subtitle"]',
  '[data-testid*="caption"]',
  '[data-testid*="subtitle"]',
];

function normalizeText(text: string, max = 12000): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

function getMetaContent(name: string, attr: 'name' | 'property' = 'name'): string {
  const node = document.querySelector(`meta[${attr}="${name}"]`);
  return normalizeText(node?.getAttribute('content') || '', 1200);
}

function extractMainText(): string {
  const selectors = ['article', 'main', '[role="main"]', '#content', '#main', '.content'];
  const root = selectors
    .map((selector) => document.querySelector(selector))
    .find(Boolean) || document.body;

  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll([
    'script',
    'style',
    'noscript',
    'svg',
    'form',
    'button',
    'nav',
    'footer',
    'header',
    '[role="navigation"]',
    '[role="banner"]',
    '[aria-hidden="true"]',
  ].join(',')).forEach((node) => node.remove());

  return normalizeText(clone.innerText || clone.textContent || '', 12000);
}

function collectDomCaptions(): string {
  const values = new Set<string>();

  for (const selector of CAPTION_SELECTORS) {
    document.querySelectorAll(selector).forEach((node) => {
      const text = normalizeText(node.textContent || '', 180);
      if (text) values.add(text);
    });
  }

  return normalizeText(Array.from(values).join('\n'), 4000);
}

function parseVtt(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => (
      line
      && !line.startsWith('WEBVTT')
      && !line.includes('-->')
      && !/^\d+$/.test(line)
    ));

  return normalizeText(lines.join('\n'), 4000);
}

async function collectTrackCaptions(): Promise<string> {
  const tracks = Array.from(document.querySelectorAll<HTMLTrackElement>('track[kind="captions"], track[kind="subtitles"]'))
    .map((track) => track.src)
    .filter(Boolean)
    .slice(0, 2);

  for (const trackUrl of tracks) {
    try {
      const response = await fetch(trackUrl);
      if (!response.ok) continue;
      const parsed = parseVtt(await response.text());
      if (parsed) return parsed;
    } catch {
      continue;
    }
  }

  return '';
}

function getVideoTitle(): string {
  return normalizeText(
    getMetaContent('og:title', 'property')
    || document.querySelector('h1')?.textContent
    || document.title,
    500,
  );
}

function getVideoDescription(): string {
  return normalizeText(
    getMetaContent('og:description', 'property')
    || getMetaContent('description')
    || document.querySelector('[data-testid="video-description"]')?.textContent
    || '',
    1600,
  );
}

async function extractPageContext(): Promise<PageContext> {
  const title = normalizeText(document.title || '', 300);
  const url = location.href;
  const domain = location.hostname;
  const mainText = extractMainText();
  const metaDescription = getMetaContent('description');
  const selectedText = normalizeText(window.getSelection?.()?.toString() || '', 1200);
  const hasVideo = Boolean(document.querySelector('video'));
  const videoTitle = hasVideo ? getVideoTitle() : '';
  const videoDescription = hasVideo ? getVideoDescription() : '';

  let captionsText = '';
  let transcriptSource: PageContext['transcriptSource'] = 'none';

  if (hasVideo) {
    captionsText = collectDomCaptions();
    if (captionsText) {
      transcriptSource = 'dom';
    } else {
      captionsText = await collectTrackCaptions();
      if (captionsText) {
        transcriptSource = 'track';
      } else if (mainText || metaDescription) {
        transcriptSource = 'page';
      }
    }
  }

  return {
    title,
    url,
    domain,
    mainText,
    metaDescription,
    selectedText,
    hasVideo,
    videoTitle,
    videoDescription,
    captionsText,
    transcriptSource,
  };
}

async function getConfiguredSiteOrigin(): Promise<string | null> {
  const result = await chrome.storage.local.get(SITE_BASE_URL_KEY);
  const raw = typeof result[SITE_BASE_URL_KEY] === 'string'
    ? result[SITE_BASE_URL_KEY]
    : DEFAULT_SITE_BASE_URL;

  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

async function shouldEnableAuthBridge(): Promise<boolean> {
  const configuredOrigin = await getConfiguredSiteOrigin();
  return Boolean(configuredOrigin && configuredOrigin === location.origin && window.top === window);
}

function syncTokenToExtension(token: string | null): void {
  if (token) {
    chrome.storage.local.set({ [AUTH_TOKEN_KEY]: token });
    return;
  }

  chrome.storage.local.remove([AUTH_TOKEN_KEY, SESSION_DATA_KEY]);
}

function injectAuthBridge(): void {
  if (document.documentElement.dataset.ecommerceAiAuthBridge === '1') return;
  document.documentElement.dataset.ecommerceAiAuthBridge = '1';

  const script = document.createElement('script');
  script.textContent = `
    (() => {
      const emit = () => {
        window.postMessage({
          source: '${AUTH_BRIDGE_EVENT}',
          token: window.localStorage.getItem('token')
        }, '*');
      };

      const originalSetItem = Storage.prototype.setItem;
      const originalRemoveItem = Storage.prototype.removeItem;
      const originalClear = Storage.prototype.clear;

      Storage.prototype.setItem = function(key, value) {
        const result = originalSetItem.apply(this, [key, value]);
        if (this === window.localStorage && key === 'token') emit();
        return result;
      };

      Storage.prototype.removeItem = function(key) {
        const result = originalRemoveItem.apply(this, [key]);
        if (this === window.localStorage && key === 'token') emit();
        return result;
      };

      Storage.prototype.clear = function() {
        const result = originalClear.apply(this);
        emit();
        return result;
      };

      window.addEventListener('storage', (event) => {
        if (event.storageArea === window.localStorage && event.key === 'token') emit();
      });

      emit();
    })();
  `;

  (document.head || document.documentElement).appendChild(script);
  script.remove();

  try {
    syncTokenToExtension(window.localStorage.getItem('token'));
  } catch {
    syncTokenToExtension(null);
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== AUTH_BRIDGE_EVENT) return;
  syncTokenToExtension(typeof event.data.token === 'string' ? event.data.token : null);
});

void shouldEnableAuthBridge().then((enabled) => {
  if (enabled) injectAuthBridge();
});

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message.type === 'PING_EXTENSION_CONTENT') {
    sendResponse({ ok: true });
    return undefined;
  }

  if (message.type === 'GET_AUTH_STATE') {
    let tokenPresent = false;

    try {
      tokenPresent = Boolean(window.localStorage.getItem('token'));
    } catch {
      tokenPresent = false;
    }

    sendResponse({
      ok: true,
      origin: location.origin,
      href: location.href,
      tokenPresent,
    });
    return undefined;
  }

  if (message.type === 'SYNC_AUTH_STATE') {
    try {
      syncTokenToExtension(window.localStorage.getItem('token'));
    } catch {
      syncTokenToExtension(null);
    }

    sendResponse({ ok: true });
    return undefined;
  }

  if (message.type !== 'GET_PAGE_CONTEXT') return undefined;

  extractPageContext()
    .then((context) => sendResponse(context))
    .catch(() => sendResponse(null));

  return true;
});

