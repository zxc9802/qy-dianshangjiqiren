import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homePagePath = path.join(__dirname, '..', 'app', 'page.tsx')

test('homepage hides trial tools and renders the video tools as formal entries', async () => {
  const source = await readFile(homePagePath, 'utf8')

  assert.match(source, /isTrial:\s*bot\.routeId === VIDEO_BREAKDOWN_BOT_ID \? false : bot\.homepageTrial \?\? true,/)
  assert.match(source, /id:\s*'video-workbench',[\s\S]*?isTrial:\s*false,/)
  assert.match(source, /id:\s*'tiktok-studio',[\s\S]*?isTrial:\s*true,/)
  assert.doesNotMatch(source, /HOMEPAGE_VISIBLE_TRIAL_BOT_IDS/)

  assert.match(
    source,
    /const visibleHomepageBots = ALL_HOMEPAGE_BOTS\.filter\(\(bot\) => !bot\.isTrial\);/,
  )
  assert.match(source, /const filteredBots = visibleHomepageBots\.filter\(\(bot\) => {/)
})
