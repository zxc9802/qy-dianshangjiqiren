import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'
import vm from 'node:vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const appRoot = path.join(__dirname, '..', 'app')
const memoryTextPath = path.join(appRoot, 'lib', 'server-memory-text.ts')

async function loadMemoryTextModule() {
  const source = await readFile(memoryTextPath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  const context = vm.createContext({
    module,
    exports: module.exports,
    require,
  })
  vm.runInContext(transpiled, context, { filename: memoryTextPath })
  return module.exports
}

test('memory extraction parser keeps safe concise memories and filters sensitive data', async () => {
  const { parseExtractedMemories } = await loadMemoryTextModule()

  const memories = parseExtractedMemories(JSON.stringify({
    memories: [
      { content: '用户主要做小红书电商内容，偏好直接给执行步骤。', type: 'preference', importance: 4 },
      { content: '手机号是 13812345678，记住客户名单。', type: 'fact', importance: 5 },
      { content: '  ', type: 'preference', importance: 1 },
    ],
  }))

  assert.deepEqual(JSON.parse(JSON.stringify(memories)), [
    {
      content: '用户主要做小红书电商内容，偏好直接给执行步骤。',
      memoryType: 'preference',
      importance: 4,
    },
  ])
})

test('memory extraction parser accepts fenced JSON from model output', async () => {
  const { parseExtractedMemories } = await loadMemoryTextModule()

  const memories = parseExtractedMemories([
    '```json',
    '{"memories":[{"content":"用户做直播电商，喜欢先给结论。","type":"business_context","importance":5}]}',
    '```',
  ].join('\n'))

  assert.equal(memories[0]?.content, '用户做直播电商，喜欢先给结论。')
  assert.equal(memories[0]?.memoryType, 'business_context')
  assert.equal(memories[0]?.importance, 5)
})

test('memory context block is capped and clearly separated from the base prompt', async () => {
  const { buildMemoryContextBlock } = await loadMemoryTextModule()

  const block = buildMemoryContextBlock([
    { content: '用户偏好中文回答。' },
    { content: '用户常做电商短视频脚本。' },
    { content: '用户希望输出表格。' },
  ], 2)

  assert.match(block, /^# 用户长期记忆/m)
  assert.match(block, /- 用户偏好中文回答。/)
  assert.match(block, /- 用户常做电商短视频脚本。/)
  assert.doesNotMatch(block, /用户希望输出表格/)
})
