import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'
import vm from 'node:vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.join(__dirname, '..')
const repoRoot = path.join(frontendRoot, '..')

async function loadNextConfig() {
  const sourcePath = path.join(frontendRoot, 'next.config.ts')
  const source = await readFile(sourcePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const cjsModule = { exports: {} }
  const context = vm.createContext({
    module: cjsModule,
    exports: cjsModule.exports,
    require: createRequire(sourcePath),
    process,
    __dirname: frontendRoot,
  })
  vm.runInContext(transpiled, context, { filename: sourcePath })
  return cjsModule.exports.default || cjsModule.exports
}

test('server output tracing includes system prompt markdown files', async () => {
  const config = await loadNextConfig()
  const includes = Object.values(config.outputFileTracingIncludes || {}).flat()

  assert.equal(path.resolve(config.outputFileTracingRoot), path.resolve(repoRoot))
  assert.ok(includes.includes('system_prompts.md'))
  assert.ok(includes.includes('system_prompts_part2.md'))
})
