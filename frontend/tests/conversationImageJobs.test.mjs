import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'
import vm from 'node:vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function loadTsModule(relativePath) {
  const modulePath = path.join(__dirname, '..', relativePath)
  const source = await readFile(modulePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const cjsModule = { exports: {} }
  const localRequire = createRequire(modulePath)
  const context = vm.createContext({
    module: cjsModule,
    exports: cjsModule.exports,
    require: localRequire,
    console,
    setTimeout,
    clearTimeout,
    globalThis,
  })
  vm.runInContext(transpiled, context, { filename: modulePath })
  return cjsModule.exports
}

async function waitForJob(getJob, timeoutMs = 500) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const job = getJob()
    if (job?.status === 'succeeded' || job?.status === 'failed') {
      return job
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return getJob()
}

test('conversation image job store records successful job results', async () => {
  const {
    startConversationImageJob,
    getConversationImageJob,
  } = await loadTsModule('app/lib/server-conversation-image-jobs.ts')

  const created = startConversationImageJob({
    conversationId: 'conversation-1',
    userId: 'user-1',
    initialMessage: '正在排队生成图片。',
    run: async ({ updateStatus }) => {
      updateStatus('正在调用后端生图。')
      return {
        content: '已生成 1 张图片。',
        kind: 'image',
        imageUrls: ['/api/image-assets/generated/test.png'],
        aspectRatio: '9:16',
      }
    },
  })

  assert.equal(created.conversationId, 'conversation-1')
  assert.equal(created.userId, 'user-1')
  assert.equal(created.status, 'queued')

  const completed = await waitForJob(() => getConversationImageJob({
    jobId: created.id,
    conversationId: 'conversation-1',
    userId: 'user-1',
  }))

  assert.equal(completed?.status, 'succeeded')
  assert.equal(completed?.message, '图片已生成。')
  assert.deepEqual(Array.from(completed?.result?.imageUrls || []), ['/api/image-assets/generated/test.png'])
  assert.equal(completed?.result?.aspectRatio, '9:16')
})

test('conversation image job store scopes jobs to the conversation owner', async () => {
  const {
    startConversationImageJob,
    getConversationImageJob,
  } = await loadTsModule('app/lib/server-conversation-image-jobs.ts')

  const created = startConversationImageJob({
    conversationId: 'conversation-2',
    userId: 'user-2',
    run: async () => ({
      content: '已生成图片。',
      kind: 'image',
      imageUrls: ['/api/image-assets/generated/scoped.png'],
    }),
  })

  assert.equal(getConversationImageJob({
    jobId: created.id,
    conversationId: 'other-conversation',
    userId: 'user-2',
  }), null)
  assert.equal(getConversationImageJob({
    jobId: created.id,
    conversationId: 'conversation-2',
    userId: 'other-user',
  }), null)
})

test('conversation image polling route and chat page wire image jobs', async () => {
  const routePath = path.join(__dirname, '..', 'app', 'api', 'conversations', '[id]', 'image-jobs', '[jobId]', 'route.ts')
  const messagesRoutePath = path.join(__dirname, '..', 'app', 'api', 'conversations', '[id]', 'messages', 'route.ts')
  const chatPagePath = path.join(__dirname, '..', 'app', 'chat', '[id]', 'page.tsx')

  const [routeSource, messagesRouteSource, chatPageSource] = await Promise.all([
    readFile(routePath, 'utf8'),
    readFile(messagesRoutePath, 'utf8'),
    readFile(chatPagePath, 'utf8'),
  ])

  assert.match(routeSource, /getConversationImageJob/)
  assert.match(messagesRouteSource, /startConversationImageJob/)
  assert.match(messagesRouteSource, /type:\s*'image_job'/)
  assert.match(chatPageSource, /pollConversationImageJob/)
  assert.match(chatPageSource, /event\.type === 'image_job'/)
})
