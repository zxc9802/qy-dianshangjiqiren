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

test('compiled image prompt keeps the current request and stays under the backend budget', async () => {
  const {
    IMAGE_GENERATION_PROMPT_MAX_LENGTH,
    buildImageGenerationPrompt,
  } = await loadImageGenerationContextModule()
  const currentPrompt = '总结以上图片中的行动清单，生成一张图，比例为16:9'
  const prompt = buildImageGenerationPrompt({
    currentPrompt,
    historyMessages: [
      { role: 'user', content: '无关背景'.repeat(1200) },
      { role: 'assistant', content: '更多无关解释'.repeat(1200) },
    ],
    compiledBrief: {
      subject: '行动清单海报',
      mustKeepDetails: ['比例为16:9', '行动清单包含：复盘成果、量化贡献、准备涨薪沟通话术'],
      visualStyle: ['清爽商务风'],
      layout: ['横版16:9', '标题在顶部', '三步行动清单卡片'],
      textToRender: ['涨薪行动清单', '复盘成果', '量化贡献', '沟通话术'],
      colors: ['蓝白配色'],
      negativeConstraints: ['不要英文', '不要复杂背景'],
      referenceImageNeeded: true,
      imagePrompt: '生成一张蓝白配色的横版16:9商务行动清单海报，标题为“涨薪行动清单”。',
    },
  })

  assert.ok(prompt.length <= IMAGE_GENERATION_PROMPT_MAX_LENGTH)
  assert.match(prompt, new RegExp(currentPrompt))
  assert.match(prompt, /比例为16:9/)
  assert.match(prompt, /涨薪行动清单/)
  assert.doesNotMatch(prompt, /无关背景无关背景无关背景/)
})

test('fallback image prompt keeps the current request when history is long', async () => {
  const {
    IMAGE_GENERATION_PROMPT_MAX_LENGTH,
    buildImageGenerationPrompt,
  } = await loadImageGenerationContextModule()
  const currentPrompt = '根据前面的讨论生成一张16:9行动清单图'
  const prompt = buildImageGenerationPrompt({
    currentPrompt,
    historyMessages: [
      { role: 'user', content: '很长的背景说明'.repeat(1500) },
      { role: 'assistant', content: '很长的分析内容'.repeat(1500) },
    ],
  })

  assert.ok(prompt.length <= IMAGE_GENERATION_PROMPT_MAX_LENGTH)
  assert.match(prompt, new RegExp(currentPrompt))
})

test('parses a GPT compiler JSON brief from fenced output', async () => {
  const { parseImagePromptCompilerOutput } = await loadImageGenerationContextModule()

  const brief = parseImagePromptCompilerOutput(`\`\`\`json
{
  "subject": "行动清单海报",
  "mustKeepDetails": ["16:9"],
  "visualStyle": ["商务"],
  "layout": ["三栏"],
  "textToRender": ["行动清单"],
  "colors": ["蓝白"],
  "negativeConstraints": ["不要英文"],
  "referenceImageNeeded": true,
  "imagePrompt": "生成一张16:9行动清单海报"
}
\`\`\``)

  assert.equal(brief?.subject, '行动清单海报')
  assert.deepEqual(Array.from(brief?.mustKeepDetails || []), ['16:9'])
  assert.equal(brief?.referenceImageNeeded, true)
  assert.equal(brief?.imagePrompt, '生成一张16:9行动清单海报')
})

test('conversation image response does not expose the internal generation prompt', async () => {
  const routePath = path.join(__dirname, '..', 'app', 'api', 'conversations', '[id]', 'messages', 'route.ts')
  const source = await readFile(routePath, 'utf8')
  const responseStart = source.indexOf('const assistantText = buildConversationImageSummary')
  const responseEnd = source.indexOf('const flushVisibleText', responseStart)
  const responseSection = source.slice(responseStart, responseEnd)

  assert.ok(responseStart > -1)
  assert.ok(responseEnd > responseStart)
  assert.doesNotMatch(responseSection, /imagePrompt:/)
})

test('conversation image route compiles image prompts with GPT-5.4 before backend generation', async () => {
  const routePath = path.join(__dirname, '..', 'app', 'api', 'conversations', '[id]', 'messages', 'route.ts')
  const source = await readFile(routePath, 'utf8')

  assert.match(source, /requestYunwuOpenAIChat/)
  assert.match(source, /GPT_5_4_MODEL/)
  assert.match(source, /IMAGE_PROMPT_COMPILER_SYSTEM_PROMPT/)
  assert.match(source, /parseImagePromptCompilerOutput/)
  assert.ok(
    source.indexOf('const compiledBrief = await compileImagePromptBrief') <
    source.indexOf('const imageResponse = await generateImageViaBackend'),
  )
})

test('conversation image route logs each image generation boundary', async () => {
  const routePath = path.join(__dirname, '..', 'app', 'api', 'conversations', '[id]', 'messages', 'route.ts')
  const source = await readFile(routePath, 'utf8')
  const markers = [
    '[Conversations] image request started',
    '[Conversations] image prompt compiled',
    '[Conversations] calling backend image generation',
    '[Conversations] backend image generation returned',
    '[Conversations] image request failed',
  ]

  for (const marker of markers) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  assert.ok(
    markers
      .slice(0, -1)
      .every((marker, index) => source.indexOf(marker) < source.indexOf(markers[index + 1])),
  )
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

test('selects the latest generated image when the prompt says above image', async () => {
  const { selectImageReferenceForPrompt } = await loadImageGenerationContextModule()

  const reference = selectImageReferenceForPrompt({
    currentPrompt: '总结以上图片中的行动清单，生成一张图，比例为16:9',
    historyMessages: [
      { role: 'assistant', content: '普通回答' },
      { role: 'assistant', imageUrls: ['https://cdn.example.test/latest.png'] },
    ],
  })

  assert.equal(reference?.url, 'https://cdn.example.test/latest.png')
})

test('selects the latest generated image when the compiler says a reference is needed', async () => {
  const { selectImageReferenceForPrompt } = await loadImageGenerationContextModule()

  const reference = selectImageReferenceForPrompt({
    currentPrompt: '按刚才讨论的方向重做一版',
    compiledBrief: { referenceImageNeeded: true },
    historyMessages: [
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
