import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { HearthApi } from '../../src/preload/api'
import { startMockOllama, type MockOllama } from './mockOllama'

// The Mac App Store edition, as far as it can be tried outside Apple's
// sandbox: what it leaves out, and what it tells the agent.

type InPage = { hearth: HearthApi }
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

let mock: MockOllama
let app: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  mock = await startMockOllama()
  const project = mkdtempSync(join(tmpdir(), 'hearth-store-project-'))
  writeFileSync(join(project, 'hello.txt'), 'hello world\n')
  const userData = mkdtempSync(join(tmpdir(), 'hearth-store-profile-'))
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      providers: [{ id: 'ollama', kind: 'ollama', name: 'Mock Ollama', baseUrl: mock.url, enabled: true }],
      chatModel: 'ollama::mock-coder:latest',
      autocompleteEnabled: false,
      indexing: false,
      agent: { autoApplyEdits: true, autoRunCommands: true, maxSteps: 10 },
      layout: { terminalVisible: true },
      lastWorkspace: project
    })
  )
  const exe = process.env.HEARTH_EXE
  const args = exe ? [] : [resolve(__dirname, '../../out/main/index.js')]
  if (process.platform === 'linux') args.push('--no-sandbox')
  const env = { ...process.env, HEARTH_USER_DATA: userData, HEARTH_STORE_EDITION: '1' }
  app = await electron.launch(exe ? { executablePath: exe, args, env } : { args, env })
  page = await app.firstWindow()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.waitForSelector('.tree-name', { timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close()
  await mock?.close()
})

test('leaves out the terminal and the update check', async () => {
  expect(await page.evaluate(() => (globalThis as unknown as InPage).hearth.edition)).toBe('store')
  // Even with the terminal turned on in the settings it came with.
  await expect(page.locator('.terminal-view')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Toggle terminal/ })).toHaveCount(0)
  const created = await page.evaluate(() => (globalThis as unknown as InPage).hearth.terminal.create({ cols: 80, rows: 24 }))
  expect(created).toEqual({ error: 'This edition of Hearth has no terminal.' })

  await page.keyboard.press(`${MOD}+Shift+P`)
  await page.keyboard.type('terminal')
  await expect(page.locator('.palette')).not.toContainText('Toggle Terminal')
  await page.locator('.palette-input input').fill('update')
  await expect(page.locator('.palette')).not.toContainText('Check for Updates')
  await page.keyboard.press('Escape')
})

test('the agent edits files but is not offered commands', async () => {
  await page.click('.composer-input')
  await page.keyboard.type('Change the greeting in hello.txt')
  await page.keyboard.press('Enter')
  // The mock asks for a command on its third step; the tool does not exist here.
  await expect(page.locator('.msg-assistant .md').last()).toContainText('All done', { timeout: 45_000 })
  const first = mock.requests.find((r) => r.path === '/api/chat')!
  const tools = (first.body.tools as { function: { name: string } }[]).map((t) => t.function.name)
  expect(tools).toContain('edit_file')
  expect(tools).not.toContain('run_command')
  const system = (first.body.messages as { role: string; content: string }[]).find((m) => m.role === 'system')!.content
  expect(system).toContain('You cannot run commands here')
  expect(system).not.toContain('Shell used by run_command')
})
