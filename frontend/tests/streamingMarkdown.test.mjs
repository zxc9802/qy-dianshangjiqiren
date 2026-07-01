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

async function loadStreamingMarkdownModule() {
  const sourcePath = path.join(appRoot, 'lib', 'streaming-markdown.ts')
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
  const context = vm.createContext({
    module: cjsModule,
    exports: cjsModule.exports,
    require: localRequire,
  })
  vm.runInContext(transpiled, context, { filename: sourcePath })
  return cjsModule.exports
}

test('splitStreamingMarkdownBlocks keeps completed paragraphs stable and current paragraph active', async () => {
  const { splitStreamingMarkdownBlocks } = await loadStreamingMarkdownModule()

  const result = splitStreamingMarkdownBlocks([
    '**错误写法**',
    '',
    '当前正在输出的段落',
  ].join('\n'))

  assert.deepEqual([...result.stableBlocks], ['**错误写法**'])
  assert.equal(result.activeBlock, '当前正在输出的段落')
})

test('splitStreamingMarkdownBlocks keeps an open fenced code block active', async () => {
  const { splitStreamingMarkdownBlocks } = await loadStreamingMarkdownModule()

  const result = splitStreamingMarkdownBlocks([
    '前面已经完成。',
    '',
    '```ts',
    'const value = 1',
  ].join('\n'))

  assert.deepEqual([...result.stableBlocks], ['前面已经完成。'])
  assert.equal(result.activeBlock, '```ts\nconst value = 1')
})

test('splitStreamingMarkdownBlocks treats a trailing blank line as block completion', async () => {
  const { splitStreamingMarkdownBlocks } = await loadStreamingMarkdownModule()

  const result = splitStreamingMarkdownBlocks('**正确写法**\n\n')

  assert.deepEqual([...result.stableBlocks], ['**正确写法**'])
  assert.equal(result.activeBlock, '')
})
