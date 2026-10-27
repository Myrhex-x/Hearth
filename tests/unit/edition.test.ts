import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Electron's App Store build keeps its single-instance cookie in a fixed
// folder. After a Force Quit it stays, and without clearing it the next
// launch would quit at once.

let dir: string
let userData: string
const realTmp = process.env.TMPDIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hearth-lock-'))
  userData = join(dir, 'Hearth')
  mkdirSync(userData)
  mkdirSync(join(dir, 'S'))
  writeFileSync(join(dir, 'S', 'SingletonCookie'), '')
  process.env.TMPDIR = dir
  Object.defineProperty(process, 'mas', { value: true, configurable: true })
  vi.resetModules()
})

afterEach(() => {
  delete (process as { mas?: boolean }).mas
  if (realTmp === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = realTmp
  rmSync(dir, { recursive: true, force: true })
})

async function clear(): Promise<void> {
  const { clearStaleInstanceLock } = await import('../../src/main/edition')
  clearStaleInstanceLock(userData)
}

describe.skipIf(process.platform === 'win32')('the App Store build after a crash', () => {
  it('clears the lock an instance that is gone left behind', async () => {
    const gone = spawnSync(process.execPath, ['-e', '']).pid
    symlinkSync(`my-mac.local-${gone}`, join(userData, 'SingletonLock'))
    await clear()
    expect(existsSync(join(dir, 'S'))).toBe(false)
  })

  it('leaves the lock of a running instance alone', async () => {
    symlinkSync(`my-mac.local-${process.ppid}`, join(userData, 'SingletonLock'))
    await clear()
    expect(existsSync(join(dir, 'S', 'SingletonCookie'))).toBe(true)
  })

  it('does nothing outside the App Store build', async () => {
    delete (process as { mas?: boolean }).mas
    await clear()
    expect(existsSync(join(dir, 'S', 'SingletonCookie'))).toBe(true)
  })
})
