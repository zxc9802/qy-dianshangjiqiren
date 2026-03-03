import { useEffect, useRef, useState } from 'react';
import { BOTS, BOT_CATEGORIES } from '../shared/bots';
import type { ExtMessage, Message, PageInfo } from '../shared/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getActiveTabId(): Promise<number | undefined> {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => tabs[0]?.id);
}

async function getPageInfo(): Promise<PageInfo | null> {
  const tabId = await getActiveTabId();
  if (!tabId) return null;
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_INFO' } satisfies ExtMessage, res => {
      resolve(res ?? null);
    });
  });
}

// ─── Main Popup component ─────────────────────────────────────────────────────
export default function Popup() {
  const [screen, setScreen] = useState<'chat' | 'login' | 'settings'>('chat');
  const [token, setToken] = useState<string | null>(null);

  // Login form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Settings
  const [apiBase, setApiBase] = useState('http://localhost:3000');

  // Page info
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);

  // Summary
  const [summary, setSummary] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);

  // Chat
  const [selectedBotId, setSelectedBotId] = useState('6');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const pageContextInjected = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    chrome.storage.local.get(['token', 'apiBase'], result => {
      if (result.token) { setToken(result.token); setScreen('chat'); }
      else setScreen('login');
      if (result.apiBase) setApiBase(result.apiBase);
    });

    // Try to read token from active tab (main site localStorage sync)
    getActiveTabId().then(tabId => {
      if (!tabId) return;
      chrome.tabs.sendMessage(tabId, { type: 'GET_TOKEN' } satisfies ExtMessage, res => {
        if (res?.token) {
          setToken(res.token);
          chrome.storage.local.set({ token: res.token });
          setScreen('chat');
        }
      });
    });

    // Get page info
    getPageInfo().then(info => { if (info) setPageInfo(info); });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  // Reset context when bot changes
  useEffect(() => {
    pageContextInjected.current = false;
    setMessages([]);
    setSummary('');
    setStreamBuffer('');
  }, [selectedBotId]);

  // ── Stream listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    const listener = (msg: ExtMessage) => {
      if (msg.type === 'CHAT_CHUNK') {
        setStreamBuffer(prev => prev + msg.content);
      }
      if (msg.type === 'CHAT_DONE') {
        setStreamBuffer(prev => {
          if (prev) {
            setMessages(msgs => {
              const copy = [...msgs];
              const last = copy[copy.length - 1];
              if (last?.role === 'assistant' && last.content === '') {
                copy[copy.length - 1] = { role: 'assistant', content: prev };
              } else {
                copy.push({ role: 'assistant', content: prev });
              }
              return copy;
            });
          }
          return '';
        });
        setIsStreaming(false);
      }
      if (msg.type === 'CHAT_ERROR') {
        setMessages(msgs => [...msgs, { role: 'assistant', content: `错误：${msg.error}` }]);
        setStreamBuffer('');
        setIsStreaming(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ── Summarize (dedicated listener) ─────────────────────────────────────────
  const handleSummarize = async () => {
    const info = pageInfo ?? (await getPageInfo());
    if (!info?.text) return;
    setIsSummarizing(true);
    setSummary('');

    const content = `请总结以下网页内容，用3-5条要点说明主要信息：\n\n标题：${info.title}\n\n${info.text}`;

    let accumulated = '';
    const captureListener = (msg: ExtMessage) => {
      if (msg.type === 'CHAT_CHUNK') {
        accumulated += msg.content;
        setSummary(accumulated);
      }
      if (msg.type === 'CHAT_DONE' || msg.type === 'CHAT_ERROR') {
        setIsSummarizing(false);
        chrome.runtime.onMessage.removeListener(captureListener);
      }
    };
    chrome.runtime.onMessage.addListener(captureListener);

    chrome.runtime.sendMessage({
      type: 'CHAT',
      payload: { botId: '6', messages: [{ role: 'user', content }] },
    } satisfies ExtMessage);
  };

  // ── Login ────────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const base = apiBase || 'http://localhost:3000';
      const res = await fetch(`${base}/api/auth?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) throw new Error(data.message || '登录失败');
      setToken(data.token);
      chrome.storage.local.set({ token: data.token });
      setScreen('chat');
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : '登录失败，请重试');
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Send message ─────────────────────────────────────────────────────────────
  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    const text = input.trim();
    setInput('');

    // First message: inject page context into the API call (but show clean text to user)
    let apiContent = text;
    if (!pageContextInjected.current && pageInfo?.text) {
      apiContent = `[当前页面：${pageInfo.title}]\n[页面内容]：${pageInfo.text.slice(0, 2000)}\n\n用户问题：${text}`;
      pageContextInjected.current = true;
    }

    const displayMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages([...displayMessages, { role: 'assistant', content: '' }]);
    setStreamBuffer('');
    setIsStreaming(true);

    // Build API messages (replace first user content with context-enriched version)
    const apiMessages: Message[] = messages.map(m => m);
    apiMessages.push({ role: 'user', content: apiContent });

    chrome.runtime.sendMessage({
      type: 'CHAT',
      payload: { botId: selectedBotId, messages: apiMessages },
    } satisfies ExtMessage);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const selectedBot = BOTS.find(b => b.id === selectedBotId);

  // ── Login screen ──────────────────────────────────────────────────────────
  if (screen === 'login') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="header">
          <span className="header-icon">🤖</span>
          <span className="header-title">电商AI智能助手</span>
          <button className="header-btn" onClick={() => setScreen('settings')}>⚙️</button>
        </div>
        <div className="login-screen">
          <div className="login-title">请先登录</div>
          <div className="login-desc">
            使用电商AI智能平台账号登录，即可在任意页面使用全部智能体。
          </div>
          {loginError && <div className="error-msg">{loginError}</div>}
          <div className="login-form">
            <input type="email" placeholder="邮箱" value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            <input type="password" placeholder="密码" value={loginPassword}
              onChange={e => setLoginPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            <button className="btn-primary" onClick={handleLogin} disabled={loginLoading}>
              {loginLoading ? '登录中...' : '登录'}
            </button>
          </div>
          <div className="settings-hint">
            服务器：{apiBase}{' '}
            <button style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 11 }}
              onClick={() => setScreen('settings')}>修改</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Settings screen ───────────────────────────────────────────────────────
  if (screen === 'settings') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="header">
          <span className="header-icon">🤖</span>
          <span className="header-title">电商AI智能助手</span>
          <button className="header-btn" onClick={() => setScreen(token ? 'chat' : 'login')}>← 返回</button>
        </div>
        <div className="settings-panel">
          <h3>设置</h3>
          <div className="settings-row">
            <label>服务器地址</label>
            <input value={apiBase} onChange={e => setApiBase(e.target.value)}
              placeholder="http://localhost:3000" />
            <span className="settings-hint">本地开发填 http://localhost:3000，生产环境填实际域名</span>
          </div>
          <button className="btn-primary" onClick={() => {
            chrome.storage.local.set({ apiBase });
            setScreen(token ? 'chat' : 'login');
          }}>保存</button>
          {token && (
            <button className="logout-btn" onClick={() => {
              chrome.storage.local.remove(['token']);
              setToken(null);
              setScreen('login');
            }}>退出登录</button>
          )}
        </div>
      </div>
    );
  }

  // ── Main chat screen ──────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '600px' }}>
      <div className="header">
        <span className="header-icon">🤖</span>
        <span className="header-title">电商AI智能助手</span>
        <button className="header-btn" onClick={() => setScreen('settings')}>⚙️</button>
      </div>

      {pageInfo && (
        <div className="page-bar">
          <span className="page-bar-title">📄 {pageInfo.title || pageInfo.url}</span>
          <button className="summarize-btn" onClick={handleSummarize}
            disabled={isSummarizing || isStreaming}>
            {isSummarizing ? '总结中...' : '总结页面'}
          </button>
        </div>
      )}

      <div className="bot-selector">
        <label>智能体：</label>
        <select value={selectedBotId} onChange={e => setSelectedBotId(e.target.value)}>
          {BOT_CATEGORIES.map(cat => (
            <optgroup key={cat} label={cat}>
              {BOTS.filter(b => b.category === cat).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {summary && (
        <div className="summary-card">
          <div className="summary-card-header">
            <span className="summary-card-title">📋 页面总结</span>
            <button className="copy-btn" onClick={() => navigator.clipboard.writeText(summary)}>复制</button>
          </div>
          <div className="summary-text">{summary}</div>
        </div>
      )}

      <div className="messages">
        {messages.length === 0 && !streamBuffer ? (
          <div className="empty-chat">
            <div style={{ fontSize: 28 }}>💬</div>
            <div>正在与 <strong>{selectedBot?.name}</strong> 对话</div>
            <div style={{ color: '#cbd5e1', fontSize: 11 }}>
              {pageInfo ? '已加载当前页面，可直接提问' : '输入你的问题开始对话'}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => {
              const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1;
              const displayContent = (isLastAssistant && msg.content === '' && isStreaming)
                ? streamBuffer
                : msg.content;
              return (
                <div key={i} className={`msg-row ${msg.role === 'user' ? 'user' : ''}`}>
                  <div className="msg-avatar">
                    {msg.role === 'user' ? '我' : (selectedBot?.name?.slice(0, 1) ?? 'A')}
                  </div>
                  <div className="msg-bubble">
                    {displayContent || (isLastAssistant && isStreaming
                      ? <span className="streaming-dot" />
                      : null)}
                  </div>
                </div>
              );
            })}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-bar">
        <textarea rows={2}
          placeholder={isStreaming ? 'AI 回复中...' : '输入问题... (Enter 发送，Shift+Enter 换行)'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
        />
        <button className="send-btn" onClick={handleSend}
          disabled={!input.trim() || isStreaming}>
          发送
        </button>
      </div>
    </div>
  );
}
