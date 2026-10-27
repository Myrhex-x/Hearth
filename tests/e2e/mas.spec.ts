import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { HearthApi } from '../../src/preload/api'

// The Mac App Store build itself: Electron's App Store edition, signed ad hoc
// and sandboxed by scripts/build-mas.mjs --local. It keeps its data in its
// container, so it starts as a new user would. Runs only when HEARTH_MAS_APP
// is the executable of such a build; CI builds one on macOS.

type InPage = { hearth: HearthApi }
const exe = process.env.HEARTH_MAS_APP ?? ''

test.skip(!exe, 'Set HEARTH_MAS_APP to the executable of a store build')
test.describe.configure({ mode: 'serial' })

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ executablePath: exe })
  const page = await app.firstWindow({ timeout: 60_000 })
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  return { app, page }
}

test('runs in the sandbox as the store edition', async () => {
  const { app, page } = await launch()
  const main = await app.evaluate(() => ({ mas: (process as { mas?: boolean }).mas === true, container: process.env.APP_SANDBOX_CONTAINER_ID ?? '' }))
  expect(main).toEqual({ mas: true, container: expect.stringMatching(/.+/) })
  expect(await page.evaluate(() => (globalThis as unknown as InPage).hearth.edition)).toBe('store')
  await expect(page.getByRole('button', { name: /Toggle terminal/ })).toHaveCount(0)
  await app.close()
})

test('opens again after a Force Quit', async () => {
  const first = await launch()
  process.kill(await first.app.evaluate(() => process.pid), 'SIGKILL')
  // Electron's App Store build leaves its single-instance lock behind: without
  // clearing it, this launch would quit before showing a window.
  const second = await launch()
  expect(await second.page.evaluate(() => (globalThis as unknown as InPage).hearth.edition)).toBe('store')
  await second.app.close()
})
