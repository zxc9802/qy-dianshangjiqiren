export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface Bot {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface PageInfo {
  title: string;
  url: string;
  text: string;
}

// Messages between popup / content / background
export type ExtMessage =
  | { type: 'GET_PAGE_INFO' }
  | { type: 'PAGE_INFO'; payload: PageInfo }
  | { type: 'GET_TOKEN' }
  | { type: 'TOKEN_RESULT'; token: string | null }
  | { type: 'CHAT'; payload: { botId: string; messages: Message[] } }
  | { type: 'CHAT_CHUNK'; content: string }
  | { type: 'CHAT_DONE' }
  | { type: 'CHAT_ERROR'; error: string };
