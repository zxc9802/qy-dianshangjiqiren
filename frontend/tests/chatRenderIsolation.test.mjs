import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const chatPagePath = path.join(__dirname, '..', 'app', 'chat', '[id]', 'page.tsx')

test('chat message rendering is memoized away from input text updates', async () => {
  const source = await readFile(chatPagePath, 'utf8')
  const chatPageStart = source.indexOf('export default function ChatPage()')
  const formatMessageStart = source.indexOf('function formatMessage(')

  assert.notEqual(chatPageStart, -1)
  assert.notEqual(formatMessageStart, -1)
  assert.match(source, /import \{[^}]*\bmemo\b[^}]*\} from 'react'/)
  assert.match(source, /const MemoizedChatMessages = memo\(function ChatMessages/)
  assert.match(source, /<MemoizedChatMessages[\s\S]*renderedMessages=\{renderedMessages\}/)

  const chatPageBody = source.slice(chatPageStart, formatMessageStart)
  assert.doesNotMatch(chatPageBody, /renderedMessages\.map\(\(message\) =>/)
})
