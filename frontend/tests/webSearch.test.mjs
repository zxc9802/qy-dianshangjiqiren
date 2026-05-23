import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'
import vm from 'node:vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..', 'app')

async function loadTsModule(relativePath, options = {}) {
  const sourcePath = path.join(appRoot, ...relativePath)
  const source = await readFile(sourcePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const cjsModule = { exports: {} }
  const localRequire = createRequire(sourcePath)
  const stubbedRequire = (specifier) => {
    if (specifier === './server-env') {
      return {
        readServerEnv: (key) => options.env?.[key],
      }
    }

    if (specifier === './chat-models') {
      return {
        DEFAULT_WEB_SEARCH_MODE: 'auto',
        WEB_SEARCH_MODE_VALUES: ['auto', 'on', 'off'],
        isWebSearchMode: (value) => ['auto', 'on', 'off'].includes(value),
      }
    }

    return localRequire(specifier)
  }
  const context = vm.createContext({
    module: cjsModule,
    exports: cjsModule.exports,
    require: stubbedRequire,
    URL,
    TextDecoder,
    TextEncoder,
    fetch: options.fetch,
    console,
  })
  vm.runInContext(transpiled, context, { filename: sourcePath })
  return cjsModule.exports
}

test('web search mode off skips AnySearch and leaves prompt unchanged', async () => {
  const { enrichSystemPromptWithWebSearch } = await loadTsModule(['lib', 'web-search.ts'], {
    env: { ANYSEARCH_API_KEY: 'test-key' },
    fetch: async () => {
      throw new Error('fetch should not be called')
    },
  })

  const result = await enrichSystemPromptWithWebSearch({
    systemPrompt: 'base prompt',
    messages: [{ role: 'user', content: '今天有什么新闻？' }],
    webSearchMode: 'off',
  })

  assert.equal(result.systemPrompt, 'base prompt')
  assert.equal(result.usedWebSearch, false)
})

test('web search mode on calls AnySearch and appends search context', async () => {
  const calls = []
  const { enrichSystemPromptWithWebSearch } = await loadTsModule(['lib', 'web-search.ts'], {
    env: { ANYSEARCH_API_KEY: 'test-key' },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return new Response(JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          results: [{
            title: 'Result A',
            url: 'https://example.com/a',
            content: 'Fresh search content',
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })

  const result = await enrichSystemPromptWithWebSearch({
    systemPrompt: 'base prompt',
    messages: [{ role: 'user', content: 'What is quantum computing?' }],
    webSearchMode: 'on',
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.anysearch.com/v1/search')
  assert.equal(calls[0].body.query, 'What is quantum computing?')
  assert.equal(calls[0].body.max_results, 5)
  assert.equal(result.usedWebSearch, true)
  assert.match(result.systemPrompt, /# 联网搜索参考/)
  assert.match(result.systemPrompt, /Result A/)
  assert.match(result.systemPrompt, /https:\/\/example\.com\/a/)
  assert.match(result.systemPrompt, /Fresh search content/)
})

test('web search mode auto only searches for freshness-sensitive queries', async () => {
  let callCount = 0
  const { enrichSystemPromptWithWebSearch } = await loadTsModule(['lib', 'web-search.ts'], {
    env: { ANYSEARCH_API_KEY: 'test-key' },
    fetch: async () => {
      callCount += 1
      return new Response(JSON.stringify({ code: 0, data: { results: [] } }), { status: 200 })
    },
  })

  const stable = await enrichSystemPromptWithWebSearch({
    systemPrompt: 'base prompt',
    messages: [{ role: 'user', content: '解释一下二分查找' }],
    webSearchMode: 'auto',
  })
  const fresh = await enrichSystemPromptWithWebSearch({
    systemPrompt: 'base prompt',
    messages: [{ role: 'user', content: '今天 OpenAI 有什么最新消息？' }],
    webSearchMode: 'auto',
  })

  assert.equal(stable.usedWebSearch, false)
  assert.equal(fresh.usedWebSearch, true)
  assert.equal(callCount, 1)
})
