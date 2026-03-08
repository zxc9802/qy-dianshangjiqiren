export type {
  ExtensionBot,
  ExtensionBotKind,
  ExtensionChatMessage,
  ExtensionSessionData,
  ExtensionSessionUser,
  LocalPageSession,
  PageContext,
  PageInsightRecord,
} from '../../../frontend/app/lib/extension-types';

export interface RuntimeMessage {
  type: 'GET_PAGE_CONTEXT' | 'OPEN_SIDE_PANEL';
}
