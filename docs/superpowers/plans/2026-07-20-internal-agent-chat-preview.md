# Internal Agent Chat Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-function `/chat2/[id]` preview for internal agents with the approved light-green focus-workbench UI while leaving `/chat/[id]` unchanged.

**Architecture:** Create an isolated preview fork of the current chat route so every existing conversation, streaming, upload, voice, report, image, and video-history behavior remains available. Keep the fork temporary and point all preview navigation back to `/chat2`; use a preview-only CSS Module and small source-contract tests so no production route or backend protocol changes are required.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules, Zustand, `next-themes`, Lucide React, Node test runner, Playwright for browser verification.

---

## File map

- Create `frontend/app/chat2/[id]/page.tsx`: isolated real-function preview route, forked from the current internal chat page and adjusted only for preview routing and approved UI composition.
- Create `frontend/app/chat2/[id]/chat2.module.css`: preview-only styling, starting from the existing specialist message/attachment styles and overriding the workbench shell.
- Create `frontend/tests/chat2Preview.test.mjs`: source contracts for route isolation, real integrations, drawers, document cards, and responsive CSS.
- Do not modify `frontend/app/chat/[id]/page.tsx` or `frontend/app/chat/[id]/chat.module.css`.
- Do not modify API routes, stores, Prisma schema, or SSO integrations.

### Task 1: Lock the preview contract with a failing test

**Files:**
- Create: `frontend/tests/chat2Preview.test.mjs`

- [ ] **Step 1: Add the source-contract test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const previewPagePath = path.join(__dirname, '..', 'app', 'chat2', '[id]', 'page.tsx')
const previewCssPath = path.join(__dirname, '..', 'app', 'chat2', '[id]', 'chat2.module.css')
const productionPagePath = path.join(__dirname, '..', 'app', 'chat', '[id]', 'page.tsx')

test('chat2 is an isolated real-function chat route', async () => {
  const [preview, production] = await Promise.all([
    readFile(previewPagePath, 'utf8'),
    readFile(productionPagePath, 'utf8'),
  ])

  assert.match(preview, /useConversationsStore/)
  assert.match(preview, /useAuthStore/)
  assert.match(preview, /startPcm16kMonoRecorder/)
  assert.match(preview, /normalizeChatStreamEvent/)
  assert.match(preview, /return `\/chat2\/\$\{botId\}/)
  assert.match(preview, /from '\.\/chat2\.module\.css'/)
  assert.doesNotMatch(preview, /mockMessages|setTimeout\([^)]*fake/i)
  assert.match(production, /return `\/chat\/\$\{botId\}/)
})

test('chat2 exposes the approved focus-workbench controls', async () => {
  const preview = await readFile(previewPagePath, 'utf8')

  assert.match(preview, /capabilityPanelOpen/)
  assert.match(preview, /能力设置/)
  assert.match(preview, /aria-label="关闭能力设置"/)
  assert.match(preview, /aria-label="关闭历史记录"/)
  assert.match(preview, /starterPrompts/)
  assert.match(preview, /sendMessage\(prompt\)/)
  assert.match(preview, /getResponseModelLabel\(responseModel\)/)
  assert.match(preview, /getWebSearchModeLabel\(webSearchMode\)/)
})

test('chat2 CSS provides document responses and responsive drawers', async () => {
  const css = await readFile(previewCssPath, 'utf8')

  assert.match(css, /--preview-mint:/)
  assert.match(css, /\.assistantMsg \.msgBubble[\s\S]*max-width:\s*100%/)
  assert.match(css, /\.capabilityDrawer/)
  assert.match(css, /\.chatSidebarOpen/)
  assert.match(css, /@media \(max-width:\s*768px\)/)
  assert.match(css, /prefers-reduced-motion/)
})
```

- [ ] **Step 2: Run the test and verify the preview does not exist yet**

Run:

```bash
cd frontend && node --test tests/chat2Preview.test.mjs
```

Expected: FAIL with `ENOENT` for `app/chat2/[id]/page.tsx`.

- [ ] **Step 3: Commit the failing contract test**

```bash
git add frontend/tests/chat2Preview.test.mjs
git commit -m "test: define internal chat preview contract"
```

### Task 2: Fork the real chat route without changing production

**Files:**
- Create: `frontend/app/chat2/[id]/page.tsx`
- Create: `frontend/app/chat2/[id]/chat2.module.css`

- [ ] **Step 1: Create byte-for-byte preview copies of the current chat files**

Create the two new files from the current working-tree versions of:

```text
frontend/app/chat/[id]/page.tsx
frontend/app/chat/[id]/chat.module.css
```

The destination paths are:

```text
frontend/app/chat2/[id]/page.tsx
frontend/app/chat2/[id]/chat2.module.css
```

Use `apply_patch` for file creation so the existing dirty production files remain untouched.

- [ ] **Step 2: Keep preview navigation inside `/chat2`**

In the preview page, change only the route builder and CSS import:

```ts
import styles from './chat2.module.css';

function buildRoute(botId: string, params: { cid?: string | null; wf?: string | null; name?: string | null }) {
    const query = new URLSearchParams();
    if (params.cid) query.set('cid', params.cid);
    if (params.wf) query.set('wf', params.wf);
    if (params.name) query.set('name', params.name);
    const search = query.toString();
    return `/chat2/${botId}${search ? `?${search}` : ''}`;
}
```

Change the workflow back-step navigation in the preview copy to:

```ts
router.push(`/chat2/${wfState.steps[prevStep].botId}?wf=1`);
```

- [ ] **Step 3: Run the isolation test**

Run:

```bash
cd frontend && node --test tests/chat2Preview.test.mjs
```

Expected: the isolation assertions PASS; focus-workbench assertions still FAIL because drawers and starters have not been added.

- [ ] **Step 4: Verify production chat files have no new staged diff**

Run:

```bash
git status --short -- 'frontend/app/chat/[id]' 'frontend/app/chat2/[id]'
```

Expected: existing user-owned modifications may remain under `chat/[id]`, while all new implementation changes are under `chat2/[id]`.

- [ ] **Step 5: Commit the isolated route fork**

```bash
git add 'frontend/app/chat2/[id]/page.tsx' 'frontend/app/chat2/[id]/chat2.module.css'
git commit -m "feat: add isolated internal chat preview route"
```

### Task 3: Add the focused empty state and preview state controls

**Files:**
- Modify: `frontend/app/chat2/[id]/page.tsx`
- Modify: `frontend/tests/chat2Preview.test.mjs`

- [ ] **Step 1: Add starter prompt data and tests**

Extend the preview test with:

```js
test('chat2 provides useful starters for the featured internal agents', async () => {
  const preview = await readFile(previewPagePath, 'utf8')

  assert.match(preview, /'35':\s*\[/)
  assert.match(preview, /'37':\s*\[/)
  assert.match(preview, /帮我拆解当前最重要的问题/)
  assert.match(preview, /分析这个视频的结构、镜头与节奏/)
})
```

Run the test and expect this new assertion to FAIL.

- [ ] **Step 2: Add preview-only state and starter prompts**

Add `SlidersHorizontal`, `X`, and `Leaf` to the Lucide import, then add:

```ts
const CHAT2_STARTER_PROMPTS: Record<string, string[]> = {
    '35': [
        '帮我拆解当前最重要的问题',
        '帮我把目标整理成可执行的 OKR',
        '帮我优化一个团队 SOP',
    ],
    '37': [
        '分析这个视频的结构、镜头与节奏',
        '把视频拆成可复用的分镜脚本',
        '总结这个视频最值得复用的创作方法',
    ],
    '36': [
        '帮我梳理今天最重要的一件事',
        '分析一份材料并给出行动建议',
        '把一个模糊想法整理成清晰方案',
    ],
};

function getStarterPrompts(botId: string, botName: string): string[] {
    return CHAT2_STARTER_PROMPTS[botId] || [
        `请介绍${botName}最适合处理的任务`,
        '帮我分析当前问题并给出下一步',
        '根据我提供的材料整理一份执行方案',
    ];
}
```

Inside `ChatPage`, add:

```ts
const [capabilityPanelOpen, setCapabilityPanelOpen] = useState(false);
const starterPrompts = useMemo(() => getStarterPrompts(botId, botName), [botId, botName]);
const showStarterPrompts = !conversationId
    && messages.length === 1
    && messages[0]?.id === 'welcome'
    && !isStreaming;
```

- [ ] **Step 3: Render the empty-state prompt cards**

After `MemoizedMessageList` and before loading/streaming components, add:

```tsx
{showStarterPrompts && (
    <section className={styles.starterPanel} aria-label="推荐开场问题">
        <div className={styles.starterEyebrow}><Leaf size={14} /> 从一个清晰动作开始</div>
        <div className={styles.starterGrid}>
            {starterPrompts.map((prompt) => (
                <button key={prompt} type="button" onClick={() => void sendMessage(prompt)}>
                    <span>{prompt}</span>
                    <ArrowRight size={15} />
                </button>
            ))}
        </div>
    </section>
)}
```

- [ ] **Step 4: Run the focused test and commit**

Run:

```bash
cd frontend && node --test tests/chat2Preview.test.mjs
```

Expected: starter prompt assertions PASS; drawer assertions still FAIL.

```bash
git add 'frontend/app/chat2/[id]/page.tsx' frontend/tests/chat2Preview.test.mjs
git commit -m "feat: add internal chat preview starters"
```

### Task 4: Move low-frequency controls into the capability drawer

**Files:**
- Modify: `frontend/app/chat2/[id]/page.tsx`
- Modify: `frontend/app/chat2/[id]/chat2.module.css`

- [ ] **Step 1: Add Escape-key and panel close behavior**

Add this effect after preview state initialization:

```ts
useEffect(() => {
    if (!capabilityPanelOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setCapabilityPanelOpen(false);
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
}, [capabilityPanelOpen]);
```

- [ ] **Step 2: Replace the always-visible meta controls with a compact summary**

Keep the existing hint logic, but render it as:

```tsx
<div className={styles.capabilitySummary}>
    <span className={styles.capabilityStatus}>
        {imageModeEnabled
            ? '绘图模式'
            : `${getResponseModelLabel(responseModel)} · ${getWebSearchModeLabel(webSearchMode)}`}
    </span>
    <button
        type="button"
        className={styles.capabilityOpenButton}
        onClick={() => setCapabilityPanelOpen(true)}
        aria-expanded={capabilityPanelOpen}
    >
        <SlidersHorizontal size={15} />
        能力设置
    </button>
</div>
```

The default input row must contain only upload, voice, textarea, and send controls.

- [ ] **Step 3: Render the real controls inside a drawer**

Move the existing model selects, web-search select, image toggle, and conditional conversation-video picker into:

```tsx
{capabilityPanelOpen && (
    <>
        <button
            type="button"
            className={styles.drawerBackdrop}
            onClick={() => setCapabilityPanelOpen(false)}
            aria-label="关闭能力设置"
        />
        <aside className={styles.capabilityDrawer} aria-label="能力设置">
            <div className={styles.capabilityDrawerHeader}>
                <div>
                    <span>CHAT CAPABILITIES</span>
                    <h2>能力设置</h2>
                </div>
                <button type="button" onClick={() => setCapabilityPanelOpen(false)} aria-label="关闭能力设置">
                    <X size={18} />
                </button>
            </div>
            <div className={styles.capabilityDrawerBody}>
                <section className={styles.capabilityGroup}>
                    <h3>输出方式</h3>
                    <button
                        type="button"
                        className={`${styles.modeToggle} ${imageModeEnabled ? styles.modeToggleActive : ''}`}
                        onClick={toggleImageMode}
                        disabled={isStreaming || isUploading || isTranscribing}
                    >
                        <ImageIcon size={16} />
                        {imageModeEnabled ? '绘图已开' : '绘图已关'}
                    </button>
                    <label className={styles.capabilityField}>
                        <span>回答模型</span>
                        <div className={styles.modelSwitcher}>
                            <select
                                aria-label="回答模型"
                                className={styles.modelSelect}
                                value={responseModel}
                                onChange={(event) => {
                                    if (isSelectableResponseModel(event.target.value)) {
                                        setResponseModel(event.target.value);
                                    }
                                }}
                                disabled={isStreaming || isUploading || isTranscribing}
                            >
                                {RESPONSE_MODEL_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <ChevronDown size={16} className={styles.modelSelectChevron} />
                        </div>
                    </label>
                </section>
                <section className={styles.capabilityGroup}>
                    <h3>联网能力</h3>
                    <label className={styles.capabilityField}>
                        <span>联网搜索模式</span>
                        <div className={styles.modelSwitcher}>
                            <select
                                aria-label="联网搜索模式"
                                className={styles.modelSelect}
                                value={webSearchMode}
                                onChange={(event) => {
                                    if (isWebSearchMode(event.target.value)) {
                                        setWebSearchMode(event.target.value);
                                    }
                                }}
                                disabled={isStreaming || isUploading || isTranscribing}
                            >
                                {WEB_SEARCH_MODE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <ChevronDown size={16} className={styles.modelSelectChevron} />
                        </div>
                    </label>
                </section>
                {showConversationVideoLibrary && (
                    <section className={styles.capabilityGroup}>
                        <h3>会话视频</h3>
                        <p>最多选择 {MAX_AUTO_REFERENCED_HISTORY_VIDEOS} 个历史视频参与本轮分析。</p>
                        {conversationVideos.length > 0 ? (
                            <div className={styles.capabilityVideoGrid}>
                                {conversationVideos.map((video) => {
                                    const selected = selectedConversationVideoIds.includes(video.clientVideoId);
                                    const reusable = canReuseConversationVideo(video);
                                    return (
                                        <button
                                            key={video.clientVideoId}
                                            type="button"
                                            className={`${styles.capabilityVideoCard} ${selected ? styles.capabilityVideoCardSelected : ''}`}
                                            onClick={() => toggleConversationVideoSelection(video)}
                                            disabled={!reusable}
                                            aria-pressed={selected}
                                            title={getConversationVideoStateLabel(video)}
                                        >
                                            <span>{video.videoLabel}</span>
                                            <strong>{video.fileName}</strong>
                                            <small>{video.isAvailableLocally ? '本机可用' : '需重新上传'}</small>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className={styles.capabilityEmpty}>当前会话还没有可复用视频</div>
                        )}
                    </section>
                )}
            </div>
        </aside>
    </>
)}
```

- [ ] **Step 4: Give the history drawer an accessible close control**

Add to the history drawer header:

```tsx
<button
    type="button"
    className={styles.drawerCloseButton}
    onClick={() => setSidebarOpen(false)}
    aria-label="关闭历史记录"
>
    <X size={18} />
</button>
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
cd frontend && node --test tests/chat2Preview.test.mjs
```

Expected: all preview source-contract tests PASS.

```bash
git add 'frontend/app/chat2/[id]/page.tsx' 'frontend/app/chat2/[id]/chat2.module.css'
git commit -m "feat: add internal chat capability drawer"
```

### Task 5: Apply the green focus-workbench visual system

**Files:**
- Modify: `frontend/app/chat2/[id]/chat2.module.css`

- [ ] **Step 1: Add preview design tokens to `.layout`**

```css
.layout {
    --preview-mint: #2f7d4a;
    --preview-mint-hover: #24643b;
    --preview-mint-soft: #e4f1e6;
    --preview-paper: #fbfdf9;
    --preview-canvas: #f1f8f1;
    --preview-line: #d5e5d8;
    --preview-ink: #173522;
    --preview-muted: #718477;
    --preview-shadow: 0 18px 60px rgba(38, 83, 51, 0.1);
    background:
        radial-gradient(circle at 10% 0%, rgba(153, 207, 164, 0.2), transparent 32%),
        linear-gradient(180deg, #f5faf4 0%, var(--preview-canvas) 100%);
    color: var(--preview-ink);
    overflow-x: hidden;
}

:global(.dark) .layout {
    --preview-mint: #91d1a0;
    --preview-mint-hover: #a8ddb3;
    --preview-mint-soft: rgba(89, 153, 104, 0.2);
    --preview-paper: #112b1f;
    --preview-canvas: #0b2117;
    --preview-line: rgba(181, 221, 189, 0.15);
    --preview-ink: #edf8ef;
    --preview-muted: #97ad9d;
    --preview-shadow: 0 22px 70px rgba(0, 0, 0, 0.3);
    background:
        radial-gradient(circle at 10% 0%, rgba(58, 119, 75, 0.3), transparent 34%),
        linear-gradient(180deg, #0b2117 0%, #0d2519 100%);
}
```

- [ ] **Step 2: Restyle the shell without changing specialist content styles**

Implement these exact outcomes in preview-only selectors:

```css
.header {
    min-height: 68px;
    padding: 0 28px;
    border-bottom: 1px solid var(--preview-line);
    background: color-mix(in srgb, var(--preview-paper) 88%, transparent);
    backdrop-filter: blur(18px);
}

.messages {
    max-width: 960px;
    gap: 18px;
}

.assistantMsg .msgBubble {
    width: 100%;
    max-width: 100%;
    padding: 24px 28px;
    border: 1px solid var(--preview-line);
    border-left: 1px solid var(--preview-line);
    border-radius: 22px 22px 22px 8px;
    background: color-mix(in srgb, var(--preview-paper) 96%, white);
    box-shadow: 0 10px 30px rgba(38, 83, 51, 0.06);
}

.userMsg .msgBubble {
    max-width: min(72%, 620px);
    border-radius: 18px 18px 6px 18px;
    background: var(--preview-mint);
    box-shadow: 0 10px 24px rgba(47, 125, 74, 0.16);
}

.inputBar {
    padding: 10px 24px 24px;
    background: linear-gradient(180deg, transparent, var(--preview-canvas) 24%);
}

.inputWrapper {
    max-width: 960px;
    min-height: 62px;
    border: 1px solid var(--preview-line);
    border-radius: 22px;
    background: var(--preview-paper);
    box-shadow: var(--preview-shadow);
}

.chatSidebar,
.capabilityDrawer {
    width: min(360px, calc(100vw - 28px));
    border-color: var(--preview-line);
    background: var(--preview-paper);
    box-shadow: var(--preview-shadow);
}
```

- [ ] **Step 3: Style starter cards, drawer groups, status summary, and focus states**

Append these preview-only component styles. Existing copied selectors continue to render image grids, video frames, attachments, tables, sources, streaming state, workflow compatibility, and the admin panel.

```css
.capabilitySummary {
    width: min(960px, 100%);
    margin: 0 auto 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: var(--preview-muted);
    font-size: 12px;
}

.capabilityStatus {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.capabilityOpenButton,
.drawerCloseButton {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 34px;
    padding: 0 12px;
    border: 1px solid var(--preview-line);
    border-radius: 999px;
    color: var(--preview-mint);
    background: var(--preview-paper);
}

.capabilityOpenButton:hover,
.drawerCloseButton:hover {
    border-color: var(--preview-mint);
    background: var(--preview-mint-soft);
}

.drawerBackdrop {
    position: fixed;
    inset: 0;
    z-index: 310;
    border: 0;
    background: rgba(17, 42, 24, 0.28);
    backdrop-filter: blur(3px);
}

.capabilityDrawer {
    position: fixed;
    inset: 12px 12px 12px auto;
    z-index: 320;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--preview-line);
    border-radius: 24px 8px 8px 24px;
}

.capabilityDrawerHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 22px;
    border-bottom: 1px solid var(--preview-line);
}

.capabilityDrawerHeader span {
    color: var(--preview-mint);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.14em;
}

.capabilityDrawerHeader h2 {
    margin: 3px 0 0;
    color: var(--preview-ink);
    font-size: 22px;
}

.capabilityDrawerHeader button {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    color: var(--preview-muted);
}

.capabilityDrawerBody {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
}

.capabilityGroup {
    display: grid;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--preview-line);
    border-radius: 18px;
    background: #f7fbf6;
}

.capabilityGroup + .capabilityGroup {
    margin-top: 12px;
}

.capabilityGroup h3,
.capabilityGroup p {
    margin: 0;
}

.capabilityGroup h3 {
    color: var(--preview-ink);
    font-size: 14px;
}

.capabilityGroup p {
    color: var(--preview-muted);
    font-size: 12px;
    line-height: 1.6;
}

.capabilityField {
    display: grid;
    gap: 7px;
    color: var(--preview-muted);
    font-size: 12px;
}

.capabilityField .modelSwitcher {
    width: 100%;
}

.capabilityVideoGrid {
    display: grid;
    gap: 8px;
}

.capabilityVideoCard {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 9px;
    padding: 11px;
    border: 1px solid var(--preview-line);
    border-radius: 13px;
    color: var(--preview-ink);
    background: var(--preview-paper);
    text-align: left;
}

.capabilityVideoCardSelected {
    border-color: var(--preview-mint);
    background: var(--preview-mint-soft);
}

.capabilityVideoCard strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
}

.capabilityVideoCard small,
.capabilityEmpty {
    color: var(--preview-muted);
    font-size: 11px;
}

.starterPanel {
    width: 100%;
    padding: 4px 0 12px;
}

.starterEyebrow {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    color: var(--preview-mint);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
}

.starterGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
}

.starterGrid button {
    min-height: 84px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--preview-line);
    border-radius: 16px;
    color: var(--preview-ink);
    background: color-mix(in srgb, var(--preview-paper) 92%, var(--preview-mint-soft));
    text-align: left;
}

.starterGrid button:hover {
    border-color: var(--preview-mint);
    transform: translateY(-2px);
}

.layout :focus-visible {
    outline: 2px solid var(--preview-mint);
    outline-offset: 2px;
}
```

- [ ] **Step 4: Run source tests and lint the preview page**

```bash
cd frontend
node --test tests/chat2Preview.test.mjs
npx eslint 'app/chat2/[id]/page.tsx'
```

Expected: PASS with no lint output.

- [ ] **Step 5: Commit the desktop visual system**

```bash
git add 'frontend/app/chat2/[id]/chat2.module.css'
git commit -m "style: add green focus chat workbench"
```

### Task 6: Complete responsive and reduced-motion behavior

**Files:**
- Modify: `frontend/app/chat2/[id]/chat2.module.css`
- Modify: `frontend/tests/chat2Preview.test.mjs`

- [ ] **Step 1: Add mobile layout rules**

```css
@media (max-width: 768px) {
    .header {
        min-height: 58px;
        padding: 0 12px;
    }

    .headerRight .historyBtn,
    .headerLeft .backBtn {
        width: 36px;
        min-width: 36px;
        padding: 0;
        gap: 0;
        font-size: 0;
    }

    .messagesContainer {
        padding: 16px 12px 10px;
    }

    .assistantMsg .msgBubble {
        padding: 18px 16px;
        border-radius: 18px 18px 18px 6px;
    }

    .userMsg .msgBubble {
        max-width: 88%;
    }

    .inputBar {
        padding: 8px 10px calc(10px + env(safe-area-inset-bottom));
    }

    .inputWrapper {
        min-height: 54px;
        border-radius: 18px;
    }

    .capabilityDrawer {
        inset: auto 8px 8px;
        width: auto;
        max-height: min(78vh, 680px);
        border-radius: 24px;
    }

    .starterGrid {
        grid-template-columns: 1fr;
    }
}

@media (prefers-reduced-motion: reduce) {
    .layout *,
    .layout *::before,
    .layout *::after {
        scroll-behavior: auto !important;
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}
```

- [ ] **Step 2: Add a CSS contract for no horizontal overflow and safe-area support**

Extend the CSS test with:

```js
assert.match(css, /env\(safe-area-inset-bottom\)/)
assert.match(css, /overflow-x:\s*hidden/)
```

- [ ] **Step 3: Run preview tests and commit**

```bash
cd frontend && node --test tests/chat2Preview.test.mjs
```

Expected: PASS.

```bash
git add 'frontend/app/chat2/[id]/chat2.module.css' frontend/tests/chat2Preview.test.mjs
git commit -m "style: finish responsive internal chat preview"
```

### Task 7: Run engineering validation

**Files:**
- Verify only; fix preview files if a command exposes a preview-specific error.

- [ ] **Step 1: Run the preview contract and existing chat rendering tests**

```bash
cd frontend
node --test tests/chat2Preview.test.mjs tests/chatRenderIsolation.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 2: Run ESLint and TypeScript**

```bash
cd frontend
npx eslint 'app/chat2/[id]/page.tsx' 'tests/chat2Preview.test.mjs'
npx tsc --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the production build**

```bash
cd frontend && npm run build
```

Expected: build succeeds and the route list includes `/chat2/[id]` while `/chat/[id]` remains present.

- [ ] **Step 4: Confirm the implementation diff is isolated**

```bash
git status --short -- 'frontend/app/chat/[id]' 'frontend/app/chat2/[id]' frontend/tests/chat2Preview.test.mjs
git diff --check -- 'frontend/app/chat2/[id]' frontend/tests/chat2Preview.test.mjs
```

Expected: no new implementation diff under `frontend/app/chat/[id]`; diff check prints nothing.

### Task 8: Verify real browser behavior

**Files:**
- Verify only.

- [ ] **Step 1: Start the preview server on the agreed local port**

```bash
cd frontend && npm run dev -- --port 3017
```

Expected: Next.js reports ready at `http://127.0.0.1:3017`.

- [ ] **Step 2: Exercise authenticated real flows**

Open and verify:

```text
http://127.0.0.1:3017/chat2/35
http://127.0.0.1:3017/chat2/37
```

Verify new conversation, continuing history, streaming response, model selection, web-search selection, image mode, file picker, drag/drop, paste, voice permission flow, report generation, favorites, delete, admin visibility, and video history behavior. Confirm every conversation and bot switch remains on `/chat2`.

- [ ] **Step 3: Verify desktop and mobile presentation**

Use Playwright or browser responsive tools at 1440×1000 and 390×844. Confirm document-style assistant cards, compact user bubbles, closed-by-default history and capability drawers, no horizontal overflow, and no message hidden under the composer.

- [ ] **Step 4: Record the handoff state**

Report the local preview URLs, checks passed, any feature that requires a physical microphone or real video file for final confirmation, and confirm that no GitHub push or production route replacement occurred.

### Task 9: Center the wide-screen workbench and expose capabilities

**Files:**
- Modify: `frontend/tests/chat2Preview.test.mjs`
- Modify: `frontend/app/chat2/[id]/page.tsx`
- Modify: `frontend/app/chat2/[id]/chat2.module.css`

- [ ] **Step 1: Update the preview contract before implementation**

Replace the capability-drawer assertions with assertions that require an always-visible capability toolbar and a shared centered width token:

```js
assert.match(preview, /className=\{styles\.capabilityToolbar\}/)
assert.doesNotMatch(preview, /capabilityPanelOpen/)
assert.match(css, /--preview-workbench-width:\s*1120px/)
assert.match(css, /margin-inline:\s*auto/)
assert.match(css, /\.capabilityToolbar/)
```

- [ ] **Step 2: Run the contract and confirm it fails**

```bash
cd frontend && node --test tests/chat2Preview.test.mjs
```

Expected: the focus-workbench or CSS test fails because the page still uses `capabilityPanelOpen` and `capabilityDrawer`.

- [ ] **Step 3: Replace the drawer trigger with the real inline controls**

In `frontend/app/chat2/[id]/page.tsx`, remove the capability drawer state, Escape handler, trigger summary, backdrop, and dialog. Render one `capabilityToolbar` above the input using the existing `toggleImageMode`, `responseModel`, `setResponseModel`, `webSearchMode`, `setWebSearchMode`, and video-selection handlers. Do not change API payloads or persistence keys.

- [ ] **Step 4: Apply one centered width contract**

In `frontend/app/chat2/[id]/chat2.module.css`, add `--preview-workbench-width: 1120px` and apply `width: min(100%, var(--preview-workbench-width)); margin-inline: auto` to `.messages`, `.suggestions`, `.attachmentList`, `.videoResolutionNotice`, `.pointsCost`, `.capabilityToolbar`, and `.inputWrapper`. Keep the assistant document card full width inside the centered workbench.

- [ ] **Step 5: Preserve mobile behavior**

At `max-width: 768px`, make `.capabilityToolbar` horizontally scrollable with hidden scrollbar styling, keep controls on one row, and retain `overflow-x: hidden` on the page layout.

- [ ] **Step 6: Run focused validation and commit**

```bash
cd frontend
node --test tests/chat2Preview.test.mjs
npx eslint 'app/chat2/[id]/page.tsx'
npx tsc --noEmit
npm run build
```

Expected: all commands pass and the build route list still includes both `/chat/[id]` and `/chat2/[id]`.

```bash
git add docs/superpowers/specs/2026-07-20-internal-agent-chat-preview-design.md docs/superpowers/plans/2026-07-20-internal-agent-chat-preview.md frontend/tests/chat2Preview.test.mjs 'frontend/app/chat2/[id]/page.tsx' 'frontend/app/chat2/[id]/chat2.module.css'
git commit -m "fix: center and expose internal chat capabilities"
```

### Task 10: Verify the revised desktop composition

**Files:**
- Verify only.

- [ ] **Step 1: Verify 1536px desktop geometry**

Open `http://127.0.0.1:3018/chat2/35` at `1536×900` and confirm the message and input rectangles have equal left and right margins within a two-pixel tolerance.

- [ ] **Step 2: Verify real controls**

Confirm the page exposes one answer-model select, one web-search select, and the image-mode button without opening a drawer. On `/chat2/37`, confirm the conversation-video control remains available.

- [ ] **Step 3: Verify 390px mobile geometry**

At `390×844`, confirm the capability toolbar scrolls independently and `document.documentElement.scrollWidth` does not exceed `window.innerWidth`.
