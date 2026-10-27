import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { HearthApi } from '../../src/preload/api'

/** The app's bridge, as seen from code that runs in its page. */
type InPage = { hearth: HearthApi }

// The real built-in engine: llama.cpp's server, as shipped in the app, runs
// models of about a megabyte from Hugging Face. It needs the network, so it
// runs only when HEARTH_REAL_ENGINE=1 (CI sets it on every system).

test.skip(!process.env.HEARTH_REAL_ENGINE, 'Set HEARTH_REAL_ENGINE=1 to run the real engine')
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let userData: string
let closed = false

function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function launchHearth(extra: Record<string, string> = {}): Promise<void> {
  const exe = process.env.HEARTH_EXE
  const args = exe ? [] : [resolve(__dirname, '../../out/main/index.js')]
  if (process.platform === 'linux') args.push('--no-sandbox')
  const env = { ...process.env, HEARTH_USER_DATA: userData, HEARTH_TEST_MODELS: 'real', ...extra }
  app = await electron.launch(exe ? { executablePath: exe, args, env } : { args, env })
  closed = false
  page = await app.firstWindow()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.waitForSelector('.tree-name', { timeout: 30_000 })
}

/** llama-server processes running one of this test's models. */
function modelProcesses(): number {
  if (process.platform === 'win32') {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq llama-server.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    return out.split('\n').filter((l) => /llama-server/i.test(l)).length
  }
  return execFileSync('ps', ['-A', '-o', 'command='], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.includes('llama-server') && /stories(-infill|-embed)?-260k\//.test(l)).length
}

test.beforeAll(async () => {
  const project = mkdtempSync(join(tmpdir(), 'hearth-engine-project-'))
  writeFileSync(join(project, 'story.md'), 'Once upon a time there was a little cat who liked to play in the garden.\n')
  writeFileSync(join(project, 'notes.md'), 'The dog ran to the park and found a red ball under a tree.\n')
  userData = mkdtempSync(join(tmpdir(), 'hearth-engine-profile-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: 'dark', lastWorkspace: project, showThinking: false, autocompleteEnabled: false }))
  await launchHearth()
})

test.afterAll(async () => {
  if (!closed) await app?.close()
})

test('downloads tiny models from Hugging Face and runs them', async () => {
  await page.evaluate(
    (names) =>
      Promise.all(
        names.map(
          (name) =>
            new Promise<void>((done, fail) => {
              const h = (globalThis as unknown as InPage).hearth
              const id = `pull-${name}`
              const off = h.llm.onPullProgress(id, (p) => {
                if (!p.done) return
                off()
                if (p.error) fail(new Error(`${name}: ${p.error}`))
                else done()
              })
              h.llm.pull(id, 'builtin', name)
            })
        )
      ),
    ['stories:260k', 'stories-infill:260k', 'stories-embed:260k']
  )

  const text = await page.evaluate(
    () =>
      new Promise<string>((done, fail) => {
        const h = (globalThis as unknown as InPage).hearth
        let out = ''
        const off = h.llm.onChatEvent('chat-1', (e) => {
          if (e.type === 'content') out += e.text
          if (e.type === 'error') {
            off()
            fail(new Error(e.message))
          }
          if (e.type === 'done') {
            off()
            done(out)
          }
        })
        h.llm.chat('chat-1', { modelId: 'builtin::stories:260k', messages: [{ role: 'user', content: 'Once upon a time' }], maxTokens: 24, temperature: 0 })
      })
  )
  expect(text.trim().length).toBeGreaterThan(0)

  const fill = await page.evaluate(() =>
    (globalThis as unknown as InPage).hearth.llm.complete('fill-1', { modelId: 'builtin::stories-infill:260k', prefix: 'Once upon a time, there was a', suffix: ' who liked to play.', maxTokens: 12, temperature: 0 })
  )
  expect(typeof fill).toBe('string')

  // Search by meaning builds its index through the engine's embeddings.
  await page.evaluate(() => (globalThis as unknown as InPage).hearth.settings.set({ embeddingModel: 'builtin::stories-embed:260k', indexing: true }))
  await expect(page.locator('.statusbar .status-button', { hasText: 'Indexed' })).toBeVisible({ timeout: 60_000 })
  const found = await page.evaluate(() => (globalThis as unknown as InPage).hearth.index.search('a cat in the garden', 2))
  expect(found.length).toBeGreaterThan(0)
})

test('the engine stops with Hearth', async () => {
  const { pid } = JSON.parse(readFileSync(join(userData, 'engine.pid'), 'utf8')) as { pid: number }
  expect(running(pid)).toBe(true)
  await app.close()
  closed = true
  await expect.poll(() => running(pid), { timeout: 15_000 }).toBe(false)
  // The models it started go with it.
  await expect.poll(modelProcesses, { timeout: 15_000 }).toBe(0)
})

test('the engine stops when Hearth is killed', async () => {
  const watchdogLog = join(userData, 'watchdog.log')
  await launchHearth({ HEARTH_WATCHDOG_LOG: watchdogLog })
  test.info().attachments.push({ name: 'watchdog log', path: watchdogLog, contentType: 'text/plain' })
  await page.evaluate(() => (globalThis as unknown as InPage).hearth.llm.warm('builtin::stories:260k', '30m'))
  const { pid } = JSON.parse(readFileSync(join(userData, 'engine.pid'), 'utf8')) as { pid: number }
  expect(running(pid)).toBe(true)
  expect(modelProcesses()).toBeGreaterThan(0)
  // No quit, no cleanup: like a crash or Force Quit. On Windows, Playwright
  // starts Hearth through cmd.exe, so app.process() is that shell, not Hearth.
  const hearth = await app.evaluate(() => process.pid)
  process.kill(hearth, 'SIGKILL')
  closed = true
  try {
    await expect.poll(() => running(pid), { timeout: 15_000 }).toBe(false)
    await expect.poll(modelProcesses, { timeout: 20_000 }).toBe(0)
  } catch (err) {
    console.log(`watchdog log:\n${existsSync(watchdogLog) ? readFileSync(watchdogLog, 'utf8') : '(none)'}`)
    throw err
  }
})
