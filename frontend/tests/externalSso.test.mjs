import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..', 'app')

async function readAppFile(...segments) {
  return readFile(path.join(appRoot, ...segments), 'utf8')
}

test('external SSO registers only the four fixed HTTPS products', async () => {
  const source = await readAppFile('lib', 'external-sso.ts')

  for (const [product, callbackUrl, secretEnv] of [
    ['xhstw', 'https://xhstw.qycm.top/api/sso/callback', 'SSO_XHSTW_CLIENT_SECRET'],
    ['xiaoshou', 'https://xiaoshou-api.qycm.top/api/sso/callback', 'SSO_XIAOSHOU_CLIENT_SECRET'],
    ['sabc', 'https://sabc.qycm.top/api/sso/callback', 'SSO_SABC_CLIENT_SECRET'],
    ['baokuangaixie', 'https://baokuangaixie.qycm.top/api/sso/callback', 'SSO_BAOKUANGAIXIE_CLIENT_SECRET'],
  ]) {
    assert.match(source, new RegExp(`${product}[\\s\\S]*${callbackUrl.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}[\\s\\S]*${secretEnv}`))
  }

  assert.match(source, /EXTERNAL_SSO_TICKET_TTL_MS\s*=\s*60_000/)
  assert.match(source, /crypto\.timingSafeEqual/)
  assert.match(source, /redirectPath\.startsWith\('\/\/'\)/)
})

test('external SSO start authenticates users and exchange validates a product secret', async () => {
  const [startRoute, exchangeRoute, source, auth] = await Promise.all([
    readAppFile('api', 'external-sso', '[product]', 'start', 'route.ts'),
    readAppFile('api', 'external-sso', '[product]', 'exchange', 'route.ts'),
    readAppFile('lib', 'external-sso.ts'),
    readAppFile('lib', 'auth.ts'),
  ])

  assert.match(startRoute, /getAuthUser/)
  assert.match(startRoute, /createExternalSsoTicket/)
  assert.match(startRoute, /buildExternalSsoCallbackUrl/)
  assert.match(exchangeRoute, /isValidExternalSsoClientSecret/)
  assert.match(exchangeRoute, /consumeExternalSsoTicket/)
  assert.match(exchangeRoute, /const token = signToken\(result\.user\.id, result\.user\.authTokenVersion\)/)
  assert.match(exchangeRoute, /expiresAt:\s*getTokenExpiresAt\(token\)/)
  assert.doesNotMatch(exchangeRoute, /signToken\([^\n]*['\"]5m['\"]\)/)
  assert.match(auth, /export function getTokenExpiresAt\(token: string\)/)
  assert.match(source, /product(?:\s*:\s*product)?/)
  assert.match(source, /usedAt:\s*null/)
  assert.match(source, /expiresAt:\s*\{\s*gt:\s*new Date\(\)/)
})
