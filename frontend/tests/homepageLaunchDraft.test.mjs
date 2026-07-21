import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const chatPagePath = path.join(__dirname, '..', 'app', 'chat2', '[id]', 'page.tsx')

test('homepage launch drafts restore the persisted prompt before automatic chat submission', async () => {
  const source = await readFile(chatPagePath, 'utf8')

  assert.match(source, /const \[hydratedLaunchDraftPrompt, setHydratedLaunchDraftPrompt\] = useState\(''\)/)
  assert.match(source, /if \(cancelled \|\| !draft\) \{/)
  assert.match(source, /setHydratedLaunchDraftPrompt\(draft\.prompt\.trim\(\)\)/)
  assert.match(source, /const effectiveLauncherDraft = launcherDraft \|\| hydratedLaunchDraftPrompt/)
  assert.match(source, /void sendMessage\(effectiveLauncherDraft\)/)
})
