import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'
import vm from 'node:vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const modulePath = path.join(__dirname, '..', 'app', 'lib', 'image-generation-context.ts')

async function loadImageGenerationContextModule() {
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
  })
  vm.runInContext(transpiled, context, { filename: modulePath })
  return cjsModule.exports
}

test('image generation prompt includes current request and the latest five user turns', async () => {
  const { buildImageGenerationPrompt } = await loadImageGenerationContextModule()
  const historyMessages = Array.from({ length: 6 }, (_, index) => {
    const turn = index + 1
    return [
      { role: 'user', content: `用户第 ${turn} 轮：产品卖点 ${turn}` },
      { role: 'assistant', content: `助手第 ${turn} 轮：设计建议 ${turn}` },
    ]
  }).flat()

  const prompt = buildImageGenerationPrompt({
    currentPrompt: '把上面的内容综合成一张宣传图',
    historyMessages,
  })

  assert.doesNotMatch(prompt, /产品卖点 1/)
  assert.doesNotMatch(prompt, /设计建议 1/)
  assert.match(prompt, /产品卖点 2/)
  assert.match(prompt, /设计建议 2/)
  assert.match(prompt, /产品卖点 6/)
  assert.match(prompt, /设计建议 6/)
  assert.match(prompt, /把上面的内容综合成一张宣传图/)
})

test('conversation image response still sends the internal prompt to the image backend without exposing it', async () => {
  const routePath = path.join(__dirname, '..', 'app', 'api', 'conversations', '[id]', 'messages', 'route.ts')
  const source = await readFile(routePath, 'utf8')
  const requestStart = source.indexOf('const imageResponse = await generateImageViaBackend')
  const requestEnd = source.indexOf('const imagePayload = imageResponse.payload', requestStart)
  const requestSection = source.slice(requestStart, requestEnd)
  const responseStart = source.indexOf('const assistantText = buildConversationImageSummary')
  const responseEnd = source.indexOf('const flushVisibleText', responseStart)
  const responseSection = source.slice(responseStart, responseEnd)

  assert.ok(requestStart > -1)
  assert.ok(requestEnd > requestStart)
  assert.match(requestSection, /prompt:\s*imagePrompt/)
  assert.ok(responseStart > -1)
  assert.ok(responseEnd > responseStart)
  assert.doesNotMatch(responseSection, /imagePrompt:/)
})

test('chat image renderer does not show the image prompt panel', async () => {
  const pagePath = path.join(__dirname, '..', 'app', 'chat', '[id]', 'page.tsx')
  const source = await readFile(pagePath, 'utf8')

  assert.doesNotMatch(source, /绘图提示词/)
})

test('selects the latest generated image for modification requests', async () => {
  const { selectImageReferenceForPrompt } = await loadImageGenerationContextModule()

  const reference = selectImageReferenceForPrompt({
    currentPrompt: '把上一张图改成浅色背景，产品不变',
    historyMessages: [
      { role: 'assistant', content: '普通回答' },
      { role: 'assistant', imageUrls: ['https://cdn.example.test/old.png'] },
      { role: 'assistant', imageUrls: ['https://cdn.example.test/latest.png'] },
    ],
  })

  assert.equal(reference?.url, 'https://cdn.example.test/latest.png')
})

test('selects the requested generated image number when modifying a batch', async () => {
  const { selectImageReferenceForPrompt } = await loadImageGenerationContextModule()

  const reference = selectImageReferenceForPrompt({
    currentPrompt: '把第2张图片里的背景改成蓝色',
    historyMessages: [
      {
        role: 'assistant',
        imageUrls: [
          'https://cdn.example.test/one.png',
          'https://cdn.example.test/two.png',
          'https://cdn.example.test/three.png',
        ],
      },
    ],
  })

  assert.equal(reference?.url, 'https://cdn.example.test/two.png')
})
