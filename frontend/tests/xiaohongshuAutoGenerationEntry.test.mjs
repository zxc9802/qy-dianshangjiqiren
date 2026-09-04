import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homePagePath = path.join(__dirname, '..', 'app', 'home2', 'page.tsx')

test('homepage lists the six protected SSO agent entries', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(source, /ssoProduct\?:\s*ExternalSsoProduct/)
  for (const entry of [
    { id: 'product-design-agent', name: '产品设计智能体', category: '电商工具', product: 'chanpinsheji' },
    { id: 'xiaohongshu-auto-generation', name: '小红书图文自动生成', category: '小红书', product: 'xhstw' },
    { id: 'sales-conversion-agent', name: '销转智能体', category: '电商工具', product: 'xiaoshou' },
    { id: 'viral-copy-rewrite-agent', name: '爆款改写智能体', category: '电商工具', product: 'baokuangaixie' },
    { id: 'sabc-project-rating-agent', name: 'SABC项目评级智能体', category: '电商工具', product: 'sabc' },
    { id: 'digital-human-agent', name: '数字人智能体', category: '视频工作台', product: 'shuziren' },
  ]) {
    assert.match(
      source,
      new RegExp(`id:\\s*'${entry.id}'[\\s\\S]*name:\\s*'${entry.name}'[\\s\\S]*category:\\s*'${entry.category}'[\\s\\S]*ssoProduct:\\s*'${entry.product}'[\\s\\S]*requiresAuth:\\s*true`),
    )
  }
  assert.match(source, /categoryOrder = \['管理工具', '电商工具', '小红书', '绘图机器人', '视频工作台'\]/)
  assert.match(source, /精选工作台 · 13/)
  assert.match(source, /当前只展示最常用的 13 个电商工作入口/)
})

test('homepage routes the product design agent through SSO', async () => {
  const source = await readFile(homePagePath, 'utf8')
  const entryStart = source.indexOf("id: 'product-design-agent'")
  const entryEnd = source.indexOf('\n  },', entryStart)
  const entry = source.slice(entryStart, entryEnd)

  assert.notEqual(entryStart, -1)
  assert.match(entry, /ssoProduct: 'chanpinsheji'/)
  assert.match(entry, /requiresAuth: true/)
  assert.doesNotMatch(entry, /externalUrl/)
})

test('homepage starts SSO before opening a target in a new tab', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(
    source,
    /if \(bot\.ssoProduct\) \{[\s\S]*api\.startExternalSso\(bot\.ssoProduct\)[\s\S]*window\.open\(result\.url, '_blank', 'noopener,noreferrer'\)/,
  )
  assert.match(
    source,
    /bot\.ssoProduct === 'shuziren'[\s\S]*window\.open\(SHUZIREN_APP_URL, '_blank', 'noopener,noreferrer'\)/,
  )
})

test('homepage can resume a target SSO launch after a direct target visit', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(source, /searchParams\.get\('externalSso'\)/)
  assert.match(source, /searchParams\.get\('state'\)/)
  assert.match(source, /currentUrl\.searchParams\.delete\('state'\)/)
  assert.match(source, /api\.startExternalSso\(product, \{ state: pendingState \}\)[\s\S]*window\.location\.assign\(result\.url\)/)
})
