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

async function loadFormatMessageModule() {
  const sourcePath = path.join(appRoot, 'lib', 'formatMessage.ts')
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

test('stripSuggestionBlock hides a streaming suggestion block before the array arrives', async () => {
  const { stripSuggestionBlock } = await loadFormatMessageModule()

  const visible = stripSuggestionBlock([
    '这是正常回答。',
    '',
    '{"suggestions":',
  ].join('\n'))

  assert.equal(visible, '这是正常回答。')
})
