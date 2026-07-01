import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const streamEventsPath = path.join(__dirname, '..', 'app', 'lib', 'chat-stream-events.ts')

async function importTypeScriptModule(filePath) {
  const source = await readFile(filePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  })

  const encoded = Buffer.from(transpiled.outputText).toString('base64')
  return import(`data:text/javascript;base64,${encoded}`)
}

test('chat stream events normalize legacy SSE payloads into typed channels', async () => {
  const { normalizeChatStreamEvent, parseChatStreamSseLine } = await importTypeScriptModule(streamEventsPath)

  const parsed = parseChatStreamSseLine('data: {"type":"text","content":"你好","runId":"run-1","seq":2}')
  assert.deepEqual(parsed, { type: 'text', content: '你好', runId: 'run-1', seq: 2 })

  assert.deepEqual(normalizeChatStreamEvent(parsed), {
    channel: 'messages',
    kind: 'delta',
    content: '你好',
    runId: 'run-1',
    seq: 2,
  })

  assert.deepEqual(normalizeChatStreamEvent({
    type: 'sources',
    content: [
      { title: 'A', url: 'https://example.com/a' },
      { title: '', url: '  ' },
    ],
  }), {
    channel: 'sources',
    sources: [{ title: 'A', url: 'https://example.com/a' }],
  })

  assert.deepEqual(normalizeChatStreamEvent({ type: 'suggestions', content: ['继续', '', '总结'] }), {
    channel: 'suggestions',
    suggestions: ['继续', '总结'],
  })

  assert.deepEqual(normalizeChatStreamEvent({
    type: 'image_job',
    content: { jobId: 'job-1', status: 'queued', message: '正在生成图片' },
  }), {
    channel: 'image_job',
    jobId: 'job-1',
    status: 'queued',
    message: '正在生成图片',
  })
})

test('chat stream events normalize LangGraph message deltas into the same message channel', async () => {
  const { normalizeChatStreamEvent } = await importTypeScriptModule(streamEventsPath)

  assert.deepEqual(normalizeChatStreamEvent({
    seq: 9,
    method: 'messages',
    params: {
      namespace: ['assistant:runtime'],
      data: {
        event: 'content-block-delta',
        message_id: 'msg-1',
        delta: { type: 'text-delta', text: '实时输出' },
      },
    },
  }), {
    channel: 'messages',
    kind: 'delta',
    content: '实时输出',
    messageId: 'msg-1',
    seq: 9,
  })
})
