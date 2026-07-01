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
  assert.match(source, /const MemoizedMessageList = memo\(function MessageList/)
  assert.match(source, /<MemoizedMessageList[\s\S]*renderedMessages=\{renderedMessages\}/)

  const chatPageBody = source.slice(chatPageStart, formatMessageStart)
  assert.doesNotMatch(chatPageBody, /renderedMessages\.map\(\(message\) =>/)
})

test('streaming message rendering is isolated from historical message rendering', async () => {
  const source = await readFile(chatPagePath, 'utf8')
  const messageListStart = source.indexOf('const MemoizedMessageList = memo(function MessageList')
  const streamingStart = source.indexOf('const StreamingMessage = memo(function StreamingMessage')
  const chatPageStart = source.indexOf('export default function ChatPage()')

  assert.notEqual(messageListStart, -1)
  assert.notEqual(streamingStart, -1)
  assert.notEqual(chatPageStart, -1)
  assert.ok(messageListStart < streamingStart)

  const messageListBlock = source.slice(messageListStart, streamingStart)
  assert.match(messageListBlock, /renderedMessages\.map\(\(message\) =>/)
  assert.doesNotMatch(messageListBlock, /\bstreamingText\b/)
  assert.doesNotMatch(messageListBlock, /\brenderedStreamingText\b/)
  assert.doesNotMatch(messageListBlock, /\bshowStreamingBubble\b/)
  assert.doesNotMatch(messageListBlock, /\bimageStatusText\b/)

  const chatPageBody = source.slice(chatPageStart)
  assert.match(chatPageBody, /<MemoizedMessageList[\s\S]*renderedMessages=\{renderedMessages\}/)
  assert.match(chatPageBody, /<StreamingMessage[\s\S]*streamingText=\{streamingText\}/)
})

test('streaming text uses incremental markdown rendering instead of full html replacement', async () => {
  const source = await readFile(chatPagePath, 'utf8')
  const streamingStart = source.indexOf('const StreamingMessage = memo(function StreamingMessage')
  const chatPageStart = source.indexOf('export default function ChatPage()')

  assert.notEqual(streamingStart, -1)
  assert.notEqual(chatPageStart, -1)

  const streamingBlock = source.slice(streamingStart, chatPageStart)
  assert.match(source, /const StreamingMarkdownMessage = memo\(function StreamingMarkdownMessage/)
  assert.match(source, /const StreamingMarkdownBlock = memo\(function StreamingMarkdownBlock/)
  assert.match(streamingBlock, /<StreamingMarkdownMessage[\s\S]*text=\{streamingText\}/)
  assert.doesNotMatch(streamingBlock, /\{streamingText\}\s*<\/div>/)
  assert.doesNotMatch(source, /\brenderedStreamingText\b/)
  assert.doesNotMatch(source, /formatMessage\(deferredStreamingText/)
  assert.doesNotMatch(source, /\buseDeferredValue\(streamingText\)/)
})

test('streaming markdown renderer caches stable blocks and only formats the active block live', async () => {
  const source = await readFile(chatPagePath, 'utf8')
  const rendererStart = source.indexOf('const StreamingMarkdownMessage = memo(function StreamingMarkdownMessage')
  const streamingMessageStart = source.indexOf('const StreamingMessage = memo(function StreamingMessage', rendererStart)

  assert.notEqual(rendererStart, -1)
  assert.notEqual(streamingMessageStart, -1)

  const rendererBlock = source.slice(rendererStart, streamingMessageStart)
  assert.match(rendererBlock, /splitStreamingMarkdownBlocks\(cleanText\)/)
  assert.match(source, /const streamingMarkdownBlockHtmlCache = new Map<string, string>\(\)/)
  assert.match(source, /function getCachedStreamingMarkdownHtml\(block: string\): string/)
  assert.match(rendererBlock, /getCachedStreamingMarkdownHtml\(block\)/)
  assert.doesNotMatch(rendererBlock, /JSON\.stringify\(stableBlocks\)/)
  assert.doesNotMatch(rendererBlock, /JSON\.parse\(stableBlocksKey\)/)
  assert.match(rendererBlock, /const activeHtml = useMemo/)
  assert.match(rendererBlock, /formatMessage\(activeBlock, false\)/)
})

test('streaming markdown does not rescan the full text to strip suggestions on every flush', async () => {
  const source = await readFile(chatPagePath, 'utf8')
  const rendererStart = source.indexOf('const StreamingMarkdownMessage = memo(function StreamingMarkdownMessage')
  const streamingMessageStart = source.indexOf('const StreamingMessage = memo(function StreamingMessage', rendererStart)

  assert.notEqual(rendererStart, -1)
  assert.notEqual(streamingMessageStart, -1)

  const rendererBlock = source.slice(rendererStart, streamingMessageStart)
  assert.match(rendererBlock, /const cleanText = text/)
  assert.doesNotMatch(rendererBlock, /stripSuggestionBlock\(text\)/)
})

test('streaming completion does not force a duplicate final flush before appending the message', async () => {
  const source = await readFile(chatPagePath, 'utf8')
  const finalTextStart = source.indexOf('const finalText = stripSuggestionBlock(fullText).trim()')
  const completionStart = source.indexOf('if (imageJobId)', finalTextStart)

  assert.notEqual(finalTextStart, -1)
  assert.notEqual(completionStart, -1)

  const finalizationBlock = source.slice(finalTextStart, completionStart)
  assert.doesNotMatch(finalizationBlock, /flushStreamingText\(\)/)
})

test('historical formatted message html is cached by message identity', async () => {
  const source = await readFile(chatPagePath, 'utf8')
  const renderedStart = source.indexOf('const renderedMessages = useMemo<RenderedMessageItem[]>(')
  const flushStart = source.indexOf('const flushStreamingText = useCallback', renderedStart)

  assert.notEqual(renderedStart, -1)
  assert.notEqual(flushStart, -1)
  assert.match(source, /interface RenderedMessageCacheEntry/)
  assert.match(source, /const renderedMessageCacheRef = useRef<Map<string, RenderedMessageCacheEntry>>\(new Map\(\)\)/)

  const renderedBlock = source.slice(renderedStart, flushStart)
  assert.match(renderedBlock, /const previousCache = renderedMessageCacheRef\.current/)
  assert.match(renderedBlock, /const cached = previousCache\.get\(message\.id\)/)
  assert.match(renderedBlock, /cached\?\.message === message/)
  assert.match(renderedBlock, /nextCache\.set\(message\.id, \{ message, rendered \}\)/)
  assert.match(renderedBlock, /renderedMessageCacheRef\.current = nextCache/)
})

test('sidebar report markers are derived outside the conversation row render', async () => {
  const source = await readFile(chatPagePath, 'utf8')

  assert.match(source, /const reportConversationIds = useMemo\(/)
  assert.doesNotMatch(source, /\{sidebarTab === 'history' && typeof window !== 'undefined' && localStorage\.getItem\(`report-\$\{conversation\.id\}`\) && \(/)
  assert.match(source, /\{sidebarTab === 'history' && reportConversationIds\.has\(conversation\.id\) && \(/)
})

test('chat stream reader dispatches typed projections instead of branching on raw events', async () => {
  const source = await readFile(chatPagePath, 'utf8')
  const readerStart = source.indexOf('const reader = response.body?.getReader()')
  const finalTextStart = source.indexOf('const finalText = stripSuggestionBlock(fullText).trim()', readerStart)

  assert.notEqual(readerStart, -1)
  assert.notEqual(finalTextStart, -1)
  assert.match(source, /normalizeChatStreamEvent/)
  assert.match(source, /parseChatStreamSseLine/)
  assert.match(source, /const applyChatStreamProjection = \(projection: ChatStreamProjection \| null\) =>/)

  const streamReaderBlock = source.slice(readerStart, finalTextStart)
  assert.match(streamReaderBlock, /applyChatStreamProjection\(normalizeChatStreamEvent\(parsedEvent\)\)/)
  assert.doesNotMatch(streamReaderBlock, /event\.type ===/)
})
