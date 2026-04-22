import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..', 'app')
const videoSitesPath = path.join(appRoot, 'lib', 'video-sites.ts')
const apiPath = path.join(appRoot, 'lib', 'api.ts')
const launcherPath = path.join(appRoot, 'bot', 'tiktok-studio', 'page.tsx')
const clientPath = path.join(appRoot, 'bot', 'video-workbench', 'VideoWorkbenchClient.tsx')
const videoSsoPath = path.join(appRoot, 'lib', 'video-sso.ts')
const nodeRequire = createRequire(import.meta.url)

async function loadVideoSsoModule(envOverrides = {}) {
  const source = await readFile(videoSsoPath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText

  const module = { exports: {} }
  const relativeMocks = {
    './auth': {
      AppError: class AppError extends Error {
        constructor(message, status, code) {
          super(message)
          this.name = 'AppError'
          this.status = status
          this.code = code
        }
      },
    },
    './prisma': {
      prisma: {
        $executeRawUnsafe: async () => undefined,
        $transaction: async (handler) => handler({}),
      },
    },
    './server-env': {
      readServerEnv: (key) => envOverrides[key] ?? process.env[key],
    },
    './video-sites': {
      VIDEO_SITE_KEYS: ['seedance', 'tiktok'],
      VIDEO_SITE_METADATA: {
        seedance: {
          key: 'seedance',
          name: '视频工作台',
          shortName: '视频工作台',
          entryPath: '/bot/video-workbench',
          defaultAppUrl: 'https://seedance.example.test',
        },
        tiktok: {
          key: 'tiktok',
          name: 'TikTok Studio',
          shortName: 'TikTok Studio',
          entryPath: '/bot/tiktok-studio',
          defaultAppUrl: 'https://tiktok.example.test',
        },
      },
    },
  }

  function localRequire(specifier) {
    if (specifier in relativeMocks) {
      return relativeMocks[specifier]
    }

    return nodeRequire(specifier)
  }

  const factory = new Function('require', 'module', 'exports', compiled)
  factory(localRequire, module, module.exports)
  return module.exports
}

test('video site metadata includes the tiktok launcher target', async () => {
  const source = await readFile(videoSitesPath, 'utf8')

  assert.match(source, /VIDEO_SITE_KEYS = \['seedance', 'tiktok'\] as const;/)
  assert.match(
    source,
    /tiktok:\s*{\s*key:\s*'tiktok',[\s\S]*entryPath:\s*'\/bot\/tiktok-studio',[\s\S]*defaultAppUrl:\s*'https:\/\/titok\.qyaijingxuan\.top',/m,
  )
})

test('main-site api type allows the tiktok site key', async () => {
  const source = await readFile(apiPath, 'utf8')

  assert.match(source, /export type VideoSiteKey = 'seedance' \| 'tiktok';/)
})

test('the tiktok launcher page delegates to the shared video workbench client', async () => {
  const source = await readFile(launcherPath, 'utf8')

  assert.match(source, /import VideoWorkbenchClient from '\.\.\/video-workbench\/VideoWorkbenchClient';/)
  assert.match(source, /<VideoWorkbenchClient site="tiktok" \/>/)
})

test('the shared launcher redirects back to the active site after login', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /return `\$\{siteMeta\.entryPath\}\?\$\{params\.toString\(\)\}`;/)
})

test('video SSO builds a site-specific external host', async () => {
  const { buildVideoSsoUrl } = await loadVideoSsoModule({
    VIDEO_APP_URL_SEEDANCE: 'https://seedance.example.test',
    VIDEO_APP_URL_TIKTOK: 'https://tiktok.example.test',
  })

  const seedanceUrl = new URL(buildVideoSsoUrl('seedance-ticket', {
    site: 'seedance',
    mainAppUrl: 'https://main.example.test',
  }))
  const tiktokUrl = new URL(buildVideoSsoUrl('tiktok-ticket', {
    site: 'tiktok',
    mainAppUrl: 'https://main.example.test',
  }))

  assert.equal(seedanceUrl.origin, 'https://seedance.example.test')
  assert.equal(tiktokUrl.origin, 'https://tiktok.example.test')
  assert.equal(seedanceUrl.searchParams.get('ticket'), 'seedance-ticket')
  assert.equal(tiktokUrl.searchParams.get('ticket'), 'tiktok-ticket')
  assert.equal(seedanceUrl.searchParams.get('mainApp'), 'https://main.example.test')
  assert.equal(tiktokUrl.searchParams.get('mainApp'), 'https://main.example.test')
})
