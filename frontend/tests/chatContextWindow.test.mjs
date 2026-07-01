import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const routePath = path.join(__dirname, '..', 'app', 'api', 'conversations', '[id]', 'messages', 'route.ts')

test('conversation message route loads ordinary text history through bounded recent pages', async () => {
  const source = await readFile(routePath, 'utf8')
  const conversationStart = source.indexOf('const conversation = await prisma.conversation.findFirst({')
  const missingConversationCheck = source.indexOf('if (!conversation)', conversationStart)

  assert.notEqual(conversationStart, -1)
  assert.notEqual(missingConversationCheck, -1)
  assert.match(source, /CHAT_CONTEXT_HISTORY_PAGE_SIZE/)
  assert.match(source, /async function loadRecentStoredPromptMessages/)
  assert.match(source, /async function loadFullStoredPromptMessages/)
  assert.match(source, /const needsFullHistory = inputType === 'image' \|\| isVideoBreakdownBot/)

  const conversationQueryBlock = source.slice(conversationStart, missingConversationCheck)
  assert.doesNotMatch(conversationQueryBlock, /messages\s*:/)
})

test('conversation message route checks initial title without scanning loaded history', async () => {
  const source = await readFile(routePath, 'utf8')

  assert.match(source, /const hasPreviousUserMessage = Boolean\(/)
  assert.match(source, /const shouldSetInitialTitle = !hasPreviousUserMessage/)
  assert.doesNotMatch(source, /conversation\.messages\.some\(\(message\) => message\.role === 'user'\)/)
})
