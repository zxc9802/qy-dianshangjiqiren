import type { ExtensionChatMessage, LocalPageSession, PageContext } from './types';
import { makePageSessionKey } from './storage';

export function createPageSession(
  tabId: number,
  pageContext: PageContext,
  overrides: Partial<LocalPageSession> = {},
): LocalPageSession {
  const messages = Array.isArray(overrides.messages)
    ? overrides.messages as ExtensionChatMessage[]
    : [];

  return {
    sessionKey: makePageSessionKey(tabId, pageContext.url),
    tabId,
    pageUrl: pageContext.url,
    pageTitle: pageContext.title,
    pageContext,
    contextSnapshot: null,
    hasPendingContext: false,
    botId: '6',
    summary: '',
    messages,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
