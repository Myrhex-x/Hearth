import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { startMockOllama, type MockOllama } from './mockOllama'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

let mock: MockOllama
let app: ElectronApplication
let page: Page
let project: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  mock = await startMockOllama()
  project = mkdtempSync(join(tmpdir(), 'hearth-e2e-project-'))
  mkdirSync(join(project, 'src'))
  writeFileSync(join(project, 'hello.txt'), 'hello world\n')
  writeFileSync(join(project, 'src', 'app.js'), 'export const answer = 1\n')
  writeFileSync(join(project, 'package.json'), '{ "name": "fixture" }\n')
  // A real repository, so the source control panel has something to show.
  const git = (...args: string[]) => execFileSync('git', ['-C', project, ...args])
  git('init', '-q')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'Hearth e2e')
  git('config', 'core.autocrlf', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'Fixture')

  const userData = mkdtempSync(join(tmpdir(), 'hearth-e2e-profile-'))
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      providers: [{ id: 'ollama', kind: 'ollama', name: 'Mock Ollama', baseUrl: mock.url, enabled: true }],
      chatModel: 'ollama::mock-coder:latest',
      autocompleteModel: 'ollama::mock-coder:latest',
      autocompleteEnabled: true,
      showThinking: false,
      agent: { autoApplyEdits: true, autoRunCommands: true, maxSteps: 10 },
      lastWorkspace: project
    })
  )
  // HEARTH_EXE points at a packaged build (CI checks the installer contents this way).
  const exe = process.env.HEARTH_EXE
  const args = exe ? [] : [resolve(__dirname, '../../out/main/index.js')]
  if (process.platform === 'linux') args.push('--no-sandbox')
  const env = { ...process.env, HEARTH_USER_DATA: userData }
  app = await electron.launch(exe ? { executablePath: exe, args, env } : { args, env })
  page = await app.firstWindow()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.waitForSelector('.tree-name', { timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close()
  await mock?.close()
})

test('opens the last project and lists its files', async () => {
  await expect(page.locator('.project-name')).toHaveText(/hearth-e2e-project/)
  await expect(page.locator('.tree-name', { hasText: 'hello.txt' })).toBeVisible()
  await expect(page.locator('.tree-name', { hasText: 'src' })).toBeVisible()
  await expect(page.locator('.hearth-pill-name')).toHaveText('mock-coder')
})

test('the agent reads, edits and runs a command', async () => {
  await page.click('.composer-input')
  await page.keyboard.type('Change the greeting in hello.txt')
  await page.keyboard.press('Enter')
  await expect(page.locator('.msg-assistant .md').last()).toContainText('All done', { timeout: 45_000 })
  expect(readFileSync(join(project, 'hello.txt'), 'utf8')).toBe('hello from hearth\n')

  const chats = mock.requests.filter((r) => r.path === '/api/chat')
  expect(chats.length).toBe(4)
  const toolResults = (chats[3].body.messages as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => m.content)
  expect(toolResults[0]).toContain('hello world')
  expect(toolResults[1]).toContain('Edited hello.txt')
  expect(toolResults[2]).toMatch(/Exit code: 0/)
  expect(toolResults[2]).toContain('hearth-ran')
  expect(toolResults[2]).toContain('second-step')
  await expect(page.locator('.changes-head')).toContainText('Changed 1 file')
  // File names in answers become links to the file.
  await expect(page.locator('.md code.md-file', { hasText: 'hello.txt' })).toBeVisible()
  await expect(page.locator('.context-meter')).toBeVisible()
})

test('undo puts the file back', async () => {
  await page.locator('.changes-head button', { hasText: 'Undo all' }).click()
  await expect.poll(() => readFileSync(join(project, 'hello.txt'), 'utf8'), { timeout: 10_000 }).toBe('hello world\n')
})

test('the last request can be taken back and edited', async () => {
  await page.hover('.msg-user')
  await page.click('.msg-user-edit')
  await expect(page.locator('.composer-input')).toHaveValue('Change the greeting in hello.txt')
  await expect(page.locator('.msg-user')).toHaveCount(0)
  await page.locator('.composer-input').fill('')
})

test('quick open finds a file', async () => {
  await page.keyboard.press(`${MOD}+P`)
  await expect(page.locator('.palette-input input')).toBeFocused()
  await page.keyboard.type('app')
  await page.keyboard.press('Enter')
  await expect(page.locator('.tab.is-active .tab-title')).toContainText('app.js')
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('answer = 1')
})

test('inline edit rewrites the selection', async () => {
  await page.click('.monaco-editor .view-lines')
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press(`${MOD}+K`)
  await expect(page.locator('.inline-edit-input')).toBeFocused()
  await page.keyboard.type('make the answer 42')
  await page.keyboard.press('Enter')
  const keep = page.locator('.inline-edit-btn.accept')
  await keep.waitFor({ timeout: 20_000 })
  await keep.click()
  await page.keyboard.press(`${MOD}+S`)
  await expect.poll(() => readFileSync(join(project, 'src', 'app.js'), 'utf8'), { timeout: 10_000 }).toContain('export const answer = 42')
})

test('autocomplete suggests and Tab accepts', async () => {
  await page.click('.monaco-editor .view-lines')
  await page.keyboard.press(`${MOD}+End`)
  await page.keyboard.press('Enter')
  await page.keyboard.type('function f() {', { delay: 20 })
  await page.keyboard.press('Enter')
  await expect(page.locator('.monaco-editor [class*="ghost-text"]').first()).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Tab')
  await page.keyboard.press(`${MOD}+S`)
  await expect.poll(() => readFileSync(join(project, 'src', 'app.js'), 'utf8'), { timeout: 10_000 }).toContain('return 42')
})

test('the terminal starts a shell', async () => {
  await page.keyboard.press('Control+Backquote')
  const rows = page.locator('.terminal-view .xterm-rows')
  await expect(rows).not.toBeEmpty({ timeout: 20_000 })
  await expect(rows).not.toContainText('could not start')
  await page.click('.terminal-view')
  await page.waitForTimeout(1500)
  await page.keyboard.type('echo term-ok')
  await page.keyboard.press('Enter')
  await expect(rows).toContainText('term-ok', { timeout: 20_000 })
})

test('commits with a message written by the model', async () => {
  await page.click('.sidebar-head .segment:nth-child(3)')
  await expect(page.locator('.scm-row', { hasText: 'app.js' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.segment-badge')).toHaveText('1')
  await page.click('.scm-write')
  await expect(page.locator('.scm-message textarea')).toHaveValue('Make the answer 42 and add f()', { timeout: 15_000 })
  await page.click('.scm-commit-btn')
  await expect(page.locator('.scm-clean')).toBeVisible({ timeout: 15_000 })
  const log = execFileSync('git', ['-C', project, 'log', '-1', '--format=%s']).toString().trim()
  expect(log).toBe('Make the answer 42 and add f()')
  const status = execFileSync('git', ['-C', project, 'status', '--porcelain']).toString().trim()
  expect(status).toBe('')
})

test('captures the window for review', async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.screenshot({ path: join('test-results', 'screens', `hearth-${process.platform}.png`) })
  await page.click('.hearth-pill')
  await page.waitForTimeout(500)
  await page.screenshot({ path: join('test-results', 'screens', `models-${process.platform}.png`) })
})
