import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homePagePath = path.join(__dirname, '..', 'app', 'home2', 'page.tsx')

test('homepage lists the four protected SSO agent entries', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(source, /ssoProduct\?:\s*ExternalSsoProduct/)
  for (const entry of [
    { id: 'xiaohongshu-auto-generation', name: '小红书图文自动生成', category: '小红书', product: 'xhstw' },
    { id: 'sales-conversion-agent', name: '销转智能体', category: '电商工具', product: 'xiaoshou' },
    { id: 'viral-copy-rewrite-agent', name: '爆款改写智能体', category: '电商工具', product: 'baokuangaixie' },
    { id: 'sabc-project-rating-agent', name: 'SABC项目评级智能体', category: '电商工具', product: 'sabc' },
  ]) {
    assert.match(
      source,
      new RegExp(`id:\\s*'${entry.id}'[\\s\\S]*name:\\s*'${entry.name}'[\\s\\S]*category:\\s*'${entry.category}'[\\s\\S]*ssoProduct:\\s*'${entry.product}'[\\s\\S]*requiresAuth:\\s*true`),
    )
  }
  assert.match(source, /categoryOrder = \['管理工具', '电商工具', '小红书', '绘图机器人', '视频工作台'\]/)
  assert.match(source, /精选工作台 · 11/)
  assert.match(source, /当前只展示最常用的 11 个电商工作入口/)
})

test('homepage starts SSO before opening a target in a new tab', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(
    source,
    /if \(bot\.ssoProduct\) \{[\s\S]*api\.startExternalSso\(bot\.ssoProduct\)[\s\S]*window\.open\(result\.url, '_blank', 'noopener,noreferrer'\)/,
  )
})

test('homepage can resume a target SSO launch after a direct target visit', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(source, /searchParams\.get\('externalSso'\)/)
  assert.match(source, /router\.replace\(`\/login\?redirect=\$\{encodeURIComponent\(`\/home2\?externalSso=\$\{product\}`\)\}`\)/)
  assert.match(source, /api\.startExternalSso\(product\)[\s\S]*window\.location\.assign\(result\.url\)/)
})
