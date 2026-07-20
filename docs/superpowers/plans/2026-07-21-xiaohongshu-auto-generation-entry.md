# Xiaohongshu Auto-Generation Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected “小红书自动生成” card to the current `/` homepage that opens `https://xhstw.qycm.top/` in a new browser tab.

**Architecture:** Extend the existing homepage `BotInfo` metadata with an optional `externalUrl` field. Add one formal Xiaohongshu tool record and handle authenticated external tools before the existing video and internal-route launch branches, leaving layout, CSS, `/home2`, and SSO code unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node.js built-in test runner, ESLint

---

## File Map

- Create `frontend/tests/xiaohongshuAutoGenerationEntry.test.mjs`: source-level regression tests for the card metadata and protected new-tab launch branch.
- Modify `frontend/app/page.tsx`: add the external target field, the new tool metadata, collection registration, and external launch handling.
- No CSS or `/home2` files change because the entry reuses the existing card renderer.

### Task 1: Add the Failing Homepage Entry Tests

**Files:**
- Create: `frontend/tests/xiaohongshuAutoGenerationEntry.test.mjs`
- Inspect: `frontend/app/page.tsx`

- [ ] **Step 1: Write the failing metadata and launch tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homePagePath = path.join(__dirname, '..', 'app', 'page.tsx')

test('homepage adds a protected Xiaohongshu auto-generation external entry', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(source, /externalUrl\?:\s*string/)
  assert.match(
    source,
    /const XIAOHONGSHU_AUTO_GENERATION_TOOL: BotInfo = \{[\s\S]*id:\s*'xiaohongshu-auto-generation'[\s\S]*name:\s*'小红书自动生成'[\s\S]*category:\s*'小红书'[\s\S]*externalUrl:\s*'https:\/\/xhstw\.qycm\.top\/'[\s\S]*isTrial:\s*false[\s\S]*requiresAuth:\s*true[\s\S]*\};/,
  )
  assert.match(
    source,
    /ALL_HOMEPAGE_BOTS: BotInfo\[] = \[[\s\S]*XIAOHONGSHU_AUTO_GENERATION_TOOL[\s\S]*\]/,
  )
})

test('homepage protects external entries and opens them in a new tab', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(
    source,
    /if \(bot\.externalUrl\) \{[\s\S]*if \(!isAuthenticated\) \{[\s\S]*router\.push\(`\/login\?redirect=\$\{encodeURIComponent\(bot\.externalUrl\)\}`\)[\s\S]*window\.open\(bot\.externalUrl, '_blank', 'noopener,noreferrer'\)[\s\S]*return;/,
  )
})
```

- [ ] **Step 2: Run the new test and verify the RED state**

Run:

```bash
cd frontend
node --test tests/xiaohongshuAutoGenerationEntry.test.mjs
```

Expected: both tests fail with assertion mismatches because `externalUrl`, `XIAOHONGSHU_AUTO_GENERATION_TOOL`, and the external launch branch do not exist.

### Task 2: Implement the Minimal Protected External Entry

**Files:**
- Modify: `frontend/app/page.tsx`
- Test: `frontend/tests/xiaohongshuAutoGenerationEntry.test.mjs`

- [ ] **Step 1: Extend the homepage tool metadata**

Add the optional field without changing existing entries:

```ts
interface BotInfo {
  id: string;
  name: string;
  category: string;
  icon: ReactNode;
  iconColor: string;
  description: string;
  pointsPerUse: number;
  isTrial: boolean;
  path?: string;
  externalUrl?: string;
  requiresAuth: boolean;
  videoSite?: VideoSiteKey;
}
```

- [ ] **Step 2: Add and register the tool record**

Place the record beside the other external tools and add it to `ALL_HOMEPAGE_BOTS`:

```tsx
const XIAOHONGSHU_AUTO_GENERATION_TOOL: BotInfo = {
  id: 'xiaohongshu-auto-generation',
  name: '小红书自动生成',
  category: '小红书',
  description: '进入小红书图文自动生成工具，完成内容生成与发布素材制作。',
  icon: <BookOpen size={22} />,
  iconColor: '#dc2626',
  externalUrl: 'https://xhstw.qycm.top/',
  pointsPerUse: 0,
  isTrial: false,
  requiresAuth: true,
};

const ALL_HOMEPAGE_BOTS: BotInfo[] = [
  KB_CHAT_TOOL,
  COPYWRITING_AGENT_TOOL,
  XIAOHONGSHU_AUTO_GENERATION_TOOL,
  ...HOMEPAGE_BOTS,
  BUYER_SHOW_TOOL,
  DETAIL_IMAGE_AGENT_TOOL,
  IMAGE_TOOL,
  ...VIDEO_WORKBENCH_TOOLS,
];
```

- [ ] **Step 3: Handle external targets before internal paths**

Add the branch at the start of `openBot`, then guard the optional internal path before existing path-based behavior:

```ts
const openBot = async (bot: BotInfo) => {
  if (bot.externalUrl) {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(bot.externalUrl)}`);
      return;
    }
    window.open(bot.externalUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  if (!bot.path) return;
  if (bot.videoSite) {
    const launchPath = `${bot.path}?autostart=1`;
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(launchPath)}`);
      return;
    }
    try {
      const result = await api.startVideoSso({ site: bot.videoSite });
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch {
      router.push(launchPath);
    }
    return;
  }
  if (bot.requiresAuth) {
    requireAuth(bot.path);
    return;
  }
  router.push(bot.path);
};
```

- [ ] **Step 4: Run the new test and verify the GREEN state**

Run:

```bash
cd frontend
node --test tests/xiaohongshuAutoGenerationEntry.test.mjs
```

Expected: 2 tests pass, 0 fail.

- [ ] **Step 5: Inspect the surgical diff**

Run:

```bash
git diff --check -- frontend/app/page.tsx frontend/tests/xiaohongshuAutoGenerationEntry.test.mjs
git diff -- frontend/app/page.tsx frontend/tests/xiaohongshuAutoGenerationEntry.test.mjs
```

Expected: only the optional external metadata, one tool record, one list registration, one launch branch, and the new tests appear; pre-existing unrelated `page.tsx` changes remain otherwise untouched.

### Task 3: Verify the Frontend and Commit the Feature

**Files:**
- Verify: `frontend/app/page.tsx`
- Verify: `frontend/tests/xiaohongshuAutoGenerationEntry.test.mjs`

- [ ] **Step 1: Run the focused lint and TypeScript checks**

Run:

```bash
cd frontend
npx eslint app/page.tsx tests/xiaohongshuAutoGenerationEntry.test.mjs
npx tsc --noEmit
```

Expected: both commands exit 0. Any failure outside the touched lines is reported separately and is not silently rewritten.

- [ ] **Step 2: Run the complete frontend test suite**

Run:

```bash
cd frontend
node --test tests/*.test.mjs
```

Expected: all tests pass. If a pre-existing unrelated test fails, preserve its exact failure text and verify the new focused test still passes.

- [ ] **Step 3: Run the production build**

Run:

```bash
cd frontend
npm run build
```

Expected: Prisma generation and Next.js production build complete successfully. If environment configuration blocks the build, report the exact missing variable or runtime error.

- [ ] **Step 4: Commit only the scoped implementation files**

Run:

```bash
git add -- frontend/app/page.tsx frontend/tests/xiaohongshuAutoGenerationEntry.test.mjs
git diff --cached --check
git diff --cached --stat
git commit -m "Add Xiaohongshu auto-generation entry"
```

Expected: the commit contains only the homepage implementation and its focused regression test; no deployment or push occurs.
