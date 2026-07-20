import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const previewPagePath = path.join(__dirname, '..', 'app', 'chat2', '[id]', 'page.tsx')
const previewCssPath = path.join(__dirname, '..', 'app', 'chat2', '[id]', 'chat2.module.css')
const productionPagePath = path.join(__dirname, '..', 'app', 'chat', '[id]', 'page.tsx')

test('production chat route uses the approved real-function workbench', async () => {
  const [preview, production] = await Promise.all([
    readFile(previewPagePath, 'utf8'),
    readFile(productionPagePath, 'utf8'),
  ])

  assert.match(preview, /useConversationsStore/)
  assert.match(preview, /useAuthStore/)
  assert.match(preview, /startPcm16kMonoRecorder/)
  assert.match(preview, /normalizeChatStreamEvent/)
  assert.match(preview, /return `\/chat\/\$\{botId\}/)
  assert.match(preview, /from '\.\/chat2\.module\.css'/)
  assert.doesNotMatch(preview, /mockMessages|setTimeout\([^)]*fake/i)
  assert.doesNotMatch(preview, /\/chat2\//)
  assert.match(production, /export \{ default \} from '\.\.\/\.\.\/chat2\/\[id\]\/page'/)
})

test('chat2 exposes the approved focus-workbench controls', async () => {
  const preview = await readFile(previewPagePath, 'utf8')

  assert.match(preview, /className=\{styles\.capabilityToolbar\}/)
  assert.doesNotMatch(preview, /capabilityToolbarLabel/)
  assert.doesNotMatch(preview, /capabilityPanelOpen/)
  assert.match(preview, /回答模型/)
  assert.match(preview, /联网搜索模式/)
  assert.match(preview, /绘图模式/)
  assert.match(preview, /aria-label="关闭历史记录"/)
  assert.match(preview, /starterPrompts/)
  assert.match(preview, /sendMessage\(prompt\)/)
})

test('chat2 provides useful starters for the featured internal agents', async () => {
  const preview = await readFile(previewPagePath, 'utf8')

  assert.match(preview, /'35':\s*\[/)
  assert.match(preview, /'37':\s*\[/)
  assert.match(preview, /帮我拆解当前最重要的问题/)
  assert.match(preview, /分析这个视频的结构、镜头与节奏/)
})

test('chat2 CSS provides centered document responses and responsive controls', async () => {
  const css = await readFile(previewCssPath, 'utf8')

  assert.match(css, /--preview-mint:/)
  assert.match(css, /--preview-workbench-width:\s*1120px/)
  assert.match(css, /\.assistantMsg \.msgBubble[\s\S]*max-width:\s*100%/)
  assert.match(css, /\.capabilityToolbar/)
  assert.match(css, /margin-inline:\s*auto/)
  assert.match(css, /\.chatSidebarOpen/)
  assert.match(css, /@media \(max-width:\s*768px\)/)
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /env\(safe-area-inset-bottom\)/)
  assert.match(css, /overflow-x:\s*hidden/)
})
