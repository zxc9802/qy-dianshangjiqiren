import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getSiteBaseUrl, setSiteBaseUrl } from '../shared/storage';
import { openMainSite, openSidePanel } from '../shared/runtime';

export default function Popup() {
  const [siteBaseUrl, setSiteBaseUrlState] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void getSiteBaseUrl().then(setSiteBaseUrlState);
  }, []);

  async function handleSave() {
    setSaving(true);
    setError('');

    try {
      const normalized = new URL(siteBaseUrl).origin;
      await setSiteBaseUrl(normalized);
      setSiteBaseUrlState(normalized);
      setSettingsOpen(false);
    } catch {
      setError('主站地址格式不正确，请填写完整的 http:// 或 https:// 地址。');
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenSidePanel() {
    await openSidePanel();
    window.close();
  }

  return (
    <div className="popup-shell">
      <header className="popup-header">
        <div>
          <div className="eyebrow">浏览器插件</div>
          <h1>网页助手</h1>
        </div>
        <button className="ghost-btn" onClick={() => setSettingsOpen((value) => !value)}>
          设置
        </button>
      </header>

      {settingsOpen ? (
        <section className="panel">
          <label className="field">
            <span>主站地址</span>
            <input
              value={siteBaseUrl}
              onChange={(event) => setSiteBaseUrlState(event.target.value)}
              placeholder="http://localhost:3000"
            />
          </label>
          <div className="actions-row">
            <button className="ghost-btn" onClick={() => setSettingsOpen(false)}>
              取消
            </button>
            <button className="primary-btn" onClick={() => void handleSave()} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </section>
      ) : null}

      {error ? <div className="error-box">{error}</div> : null}

      <section className="panel">
        <div className="panel-title">使用方式</div>
        <p className="empty-copy">
          默认入口已经改成“点击扩展图标直接打开侧边栏”。如果当前浏览器没有自动拉出侧边栏，也可以点下面按钮手动打开。
        </p>
      </section>

      <section className="footer-actions">
        <button className="ghost-btn wide-btn" onClick={() => void openMainSite('/login')}>
          打开主站
        </button>
        <button className="primary-btn wide-btn" onClick={() => void handleOpenSidePanel()}>
          打开侧边栏
        </button>
      </section>
    </div>
  );
}

const popupRoot = document.getElementById('root');
if (popupRoot) {
  createRoot(popupRoot).render(<Popup />);
}
