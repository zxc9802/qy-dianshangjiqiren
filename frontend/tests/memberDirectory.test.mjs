import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..', 'app')
const memberDirectoryPath = path.join(appRoot, 'lib', 'member-directory.ts')
const loginPagePath = path.join(appRoot, 'login', 'page.tsx')
const profilePagePath = path.join(appRoot, 'profile', 'page.tsx')

function extractFixedMemberNames(source) {
  const blockMatch = source.match(/export const FIXED_MEMBER_NAMES = \[([\s\S]*?)\] as const;/)
  assert.ok(blockMatch, 'FIXED_MEMBER_NAMES array should be present')

  return [...blockMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

test('fixed member directory includes Ran Jianglong', async () => {
  const source = await readFile(memberDirectoryPath, 'utf8')
  const names = extractFixedMemberNames(source)

  assert.equal(names.length, 30)
  assert.ok(names.includes('冉江龙'))
  assert.ok(names.includes('罗嘉俊'))
})

test('member count hints match the fixed directory size', async () => {
  const loginPage = await readFile(loginPagePath, 'utf8')
  const profilePage = await readFile(profilePagePath, 'utf8')

  assert.match(loginPage, /姓名固定为 30 人名单/)
  assert.match(profilePage, /姓名只能从固定 30 人名单中搜索选择/)
})
