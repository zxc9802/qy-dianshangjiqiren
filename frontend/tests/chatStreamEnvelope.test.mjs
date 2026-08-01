import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const messageRoutePath = path.join(__dirname, '..', 'app', 'api', 'conversations', '[id]', 'messages', 'route.ts')
const chatPagePath = path.join(__dirname, '..', 'app', 'chat2', '[id]', 'page.tsx')

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

test('conversation completion does not wait for long-term memory extraction', async () => {
  const source = await readFile(messageRoutePath, 'utf8')
  const completionStart = source.indexOf('const finalResponse = fullResponse.trim()')
  const completionEnd = source.indexOf('} catch (error)', completionStart)

  assert.notEqual(completionStart, -1)
  assert.notEqual(completionEnd, -1)

  const completionBlock = source.slice(completionStart, completionEnd)
  const persistenceIndex = completionBlock.indexOf('await prisma.$transaction')
  const deferredMemoryIndex = completionBlock.indexOf('after(() => rememberConversationTurn({')
  const doneIndex = completionBlock.indexOf("emitStreamEvent({ type: 'done' })")

  assert.ok(persistenceIndex >= 0)
  assert.ok(deferredMemoryIndex > persistenceIndex)
  assert.ok(doneIndex > deferredMemoryIndex)
  assert.doesNotMatch(completionBlock, /await rememberConversationTurn\(/)
})

test('chat UI completes on the done event instead of waiting only for HTTP EOF', async () => {
  const source = await readFile(chatPagePath, 'utf8')
  const readerStart = source.indexOf('const reader = response.body?.getReader()')
  const streamingEnd = source.indexOf('setIsStreaming(false)', readerStart)

  assert.notEqual(readerStart, -1)
  assert.notEqual(streamingEnd, -1)

  const streamingBlock = source.slice(readerStart, streamingEnd)
  assert.match(streamingBlock, /if \(projection\.channel === 'done'\) \{\s+return true;\s+\}/)
  assert.match(streamingBlock, /streamCompleted = applyChatStreamProjection\(normalizeChatStreamEvent\(parsedEvent\)\) \|\| streamCompleted/)
  assert.match(streamingBlock, /if \(streamCompleted \|\| done\) break/)
})
