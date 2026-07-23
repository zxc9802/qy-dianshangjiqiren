import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homePagePath = path.join(__dirname, '..', 'app', 'home2', 'page.tsx')

test('homepage lists protected external agent entries', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(source, /externalUrl\?:\s*string/)
  for (const entry of [
    { id: 'xiaohongshu-auto-generation', name: '小红书图文自动生成', category: '小红书', url: 'https://xhstw.qycm.top/' },
    { id: 'sales-conversion-agent', name: '销转智能体', category: '电商工具', url: 'http://xiaoshou.qycm.top' },
    { id: 'viral-copy-rewrite-agent', name: '爆款改写智能体', category: '电商工具', url: 'http://baokuangaixie.qycm.top' },
    { id: 'sabc-project-rating-agent', name: 'SABC项目评级智能体', category: '电商工具', url: 'http://sabc.qycm.top' },
  ]) {
    assert.match(
      source,
      new RegExp(`id:\\s*'${entry.id}'[\\s\\S]*name:\\s*'${entry.name}'[\\s\\S]*category:\\s*'${entry.category}'[\\s\\S]*externalUrl:\\s*'${entry.url.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}'[\\s\\S]*requiresAuth:\\s*true`),
    )
  }
  assert.match(source, /categoryOrder = \['管理工具', '电商工具', '小红书', '绘图机器人', '视频工作台'\]/)
  assert.match(source, /精选工作台 · 11/)
  assert.match(source, /当前只展示最常用的 11 个电商工作入口/)
})

test('homepage protects external entries and opens them in a new tab', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(
    source,
    /if \(bot\.externalUrl\) \{[\s\S]*if \(!isAuthenticated\) \{[\s\S]*router\.push\(`\/login\?redirect=\$\{encodeURIComponent\(bot\.externalUrl\)\}`\)[\s\S]*window\.open\(bot\.externalUrl, '_blank', 'noopener,noreferrer'\)[\s\S]*return;/,
  )
})
