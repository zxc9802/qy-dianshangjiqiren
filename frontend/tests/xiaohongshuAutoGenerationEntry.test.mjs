import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homePagePath = path.join(__dirname, '..', 'app', 'home2', 'page.tsx')

test('homepage adds a protected Xiaohongshu auto-generation external entry', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(source, /externalUrl\?:\s*string/)
  assert.match(
    source,
    /const FEATURED_BOTS: DemoBot\[] = \[[\s\S]*id:\s*'xiaohongshu-auto-generation'[\s\S]*name:\s*'小红书图文自动生成'[\s\S]*category:\s*'小红书'[\s\S]*externalUrl:\s*'https:\/\/xhstw\.qycm\.top\/'[\s\S]*requiresAuth:\s*true[\s\S]*\]/,
  )
  assert.match(source, /categoryOrder = \['管理工具', '电商工具', '小红书', '绘图机器人', '视频工作台'\]/)
  assert.match(source, /精选工作台 · 08/)
  assert.match(source, /当前只展示最常用的 8 个电商工作入口/)
})

test('homepage protects external entries and opens them in a new tab', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(
    source,
    /if \(bot\.externalUrl\) \{[\s\S]*if \(!isAuthenticated\) \{[\s\S]*router\.push\(`\/login\?redirect=\$\{encodeURIComponent\(bot\.externalUrl\)\}`\)[\s\S]*window\.open\(bot\.externalUrl, '_blank', 'noopener,noreferrer'\)[\s\S]*return;/,
  )
})
