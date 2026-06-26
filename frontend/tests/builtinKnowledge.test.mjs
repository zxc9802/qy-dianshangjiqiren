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

async function loadBuiltinKnowledgeModule() {
  const sourcePath = path.join(appRoot, 'lib', 'builtin-knowledge.ts')
  const source = await readFile(sourcePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
  }).outputText
  const cjsModule = { exports: {} }
  const localRequire = createRequire(sourcePath)
  const stubbedRequire = (specifier) => {
    if (specifier === './builtin-bots') {
      return {
        QIYA_ENTERPRISE_MANAGEMENT_BOT_ID: '35',
        BUILTIN_BOT_MAP: {
          '1': { name: 'KPI教练' },
          '35': { name: '起芽成长特助' },
        },
      }
    }

    return localRequire(specifier)
  }
  const context = vm.createContext({
    module: cjsModule,
    exports: cjsModule.exports,
    require: stubbedRequire,
  })
  vm.runInContext(transpiled, context, { filename: sourcePath })
  return cjsModule.exports
}

test('qiya bot always instructs answers to start with a relevant company-principles intro', async () => {
  const { buildPromptWithBuiltinKnowledge } = await loadBuiltinKnowledgeModule()

  const prompt = buildPromptWithBuiltinKnowledge('35', 'BASE_PROMPT', [
    { role: 'user', content: '我是人事，想制定个 OKR' },
  ])

  assert.match(prompt, /先按起芽的公司原则校准一下/)
  assert.match(prompt, /公司利益大于团队利益和个人利益/)
  assert.match(prompt, /人材是公司的核心资产/)
})

test('qiya bot still includes matched knowledge references for direct value questions', async () => {
  const { buildPromptWithBuiltinKnowledge } = await loadBuiltinKnowledgeModule()

  const prompt = buildPromptWithBuiltinKnowledge('35', 'BASE_PROMPT', [
    { role: 'user', content: '公司价值观是什么？' },
  ])

  assert.match(prompt, /# 参考材料/)
  assert.match(prompt, /诚信、好学、尽责、创新/)
})

test('non-qiya bots keep existing builtin knowledge behavior', async () => {
  const { buildPromptWithBuiltinKnowledge } = await loadBuiltinKnowledgeModule()

  const prompt = buildPromptWithBuiltinKnowledge('1', 'BASE_PROMPT', [
    { role: 'user', content: '我是人事，想制定个 OKR' },
  ])

  assert.equal(prompt, 'BASE_PROMPT')
})
