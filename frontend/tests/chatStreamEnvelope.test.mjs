import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const messageRoutePath = path.join(__dirname, '..', 'app', 'api', 'conversations', '[id]', 'messages', 'route.ts')

test('conversation SSE events are emitted through a typed envelope with run ordering metadata', async () => {
  const source = await readFile(messageRoutePath, 'utf8')
  const streamStart = source.indexOf('const stream = new ReadableStream')
  const responseStart = source.indexOf('return new Response(stream', streamStart)

  assert.notEqual(streamStart, -1)
  assert.notEqual(responseStart, -1)
  assert.match(source, /function createChatStreamEmitter/)

  const streamBlock = source.slice(streamStart, responseStart)
  assert.match(streamBlock, /const emitStreamEvent = createChatStreamEmitter\(controller, encoder\)/)
  assert.match(streamBlock, /emitStreamEvent\(\{ type: 'text', content: visibleDelta \}\)/)
  assert.match(streamBlock, /emitStreamEvent\(\{ type: 'done' \}\)/)
  assert.doesNotMatch(streamBlock, /controller\.enqueue\(encoder\.encode\(`data: \$\{JSON\.stringify\(/)
})
