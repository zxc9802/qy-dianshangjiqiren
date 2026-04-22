import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..', 'app')
const videoSitesPath = path.join(appRoot, 'lib', 'video-sites.ts')
const apiPath = path.join(appRoot, 'lib', 'api.ts')
const launcherPath = path.join(appRoot, 'bot', 'tiktok-studio', 'page.tsx')
const clientPath = path.join(appRoot, 'bot', 'video-workbench', 'VideoWorkbenchClient.tsx')

test('video site metadata includes the tiktok launcher target', async () => {
  const source = await readFile(videoSitesPath, 'utf8')

  assert.match(source, /VIDEO_SITE_KEYS = \['seedance', 'tiktok'\] as const;/)
  assert.match(
    source,
    /tiktok:\s*{\s*key:\s*'tiktok',[\s\S]*entryPath:\s*'\/bot\/tiktok-studio',[\s\S]*defaultAppUrl:\s*'https:\/\/titok\.qyaijingxuan\.top',/m,
  )
})

test('main-site api type allows the tiktok site key', async () => {
  const source = await readFile(apiPath, 'utf8')

  assert.match(source, /export type VideoSiteKey = 'seedance' \| 'tiktok';/)
})

test('the tiktok launcher page delegates to the shared video workbench client', async () => {
  const source = await readFile(launcherPath, 'utf8')

  assert.match(source, /import VideoWorkbenchClient from '\.\.\/video-workbench\/VideoWorkbenchClient';/)
  assert.match(source, /<VideoWorkbenchClient site="tiktok" \/>/)
})

test('the shared launcher redirects back to the active site after login', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /return `\$\{siteMeta\.entryPath\}\?\$\{params\.toString\(\)\}`;/)
})
