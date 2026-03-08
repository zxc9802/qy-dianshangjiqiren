import { DEFAULT_SITE_BASE_URL, SITE_BASE_URL_KEY } from '../shared/storage';

async function openCurrentWindowSidePanel(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.windowId) return;

  if (typeof activeTab.id === 'number') {
    await chrome.sidePanel.setOptions({
      tabId: activeTab.id,
      path: 'sidepanel.html',
      enabled: true,
    });

    try {
      await chrome.sidePanel.open({ tabId: activeTab.id });
      return;
    } catch {
      // Fall back to opening by window when tab-scoped open is unavailable.
    }
  }

  await chrome.sidePanel.open({ windowId: activeTab.windowId });
}

async function configureActionClickBehavior(): Promise<void> {
  if (!chrome.sidePanel?.setPanelBehavior) return;

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // Keep the manual click handler below as a fallback for browsers that do not support it.
  }
}

async function initializeBackground(): Promise<void> {
  const current = await chrome.storage.local.get(SITE_BASE_URL_KEY);
  if (typeof current[SITE_BASE_URL_KEY] !== 'string') {
    await chrome.storage.local.set({ [SITE_BASE_URL_KEY]: DEFAULT_SITE_BASE_URL });
  }
  await configureActionClickBehavior();
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeBackground();
});

chrome.runtime.onStartup.addListener(() => {
  void configureActionClickBehavior();
});

chrome.action.onClicked.addListener(() => {
  void openCurrentWindowSidePanel();
});

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message.type !== 'OPEN_SIDE_PANEL') return undefined;

  openCurrentWindowSidePanel()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : '打开侧边栏失败',
      });
    });

  return true;
});
