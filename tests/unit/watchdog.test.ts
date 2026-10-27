import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WATCHDOG_JS, WATCHDOG_SH } from '../../src/main/engine/router'

// The engine must not outlive Hearth, even when Hearth is killed. A parent
// process starts a watchdog with a stand-in server, then dies without any
// cleanup; the server has to go with it.

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hearth-watchdog-'))
  writeFileSync(join(dir, 'server.cjs'), `require('fs').writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000)`)
  writeFileSync(join(dir, 'watchdog.cjs'), WATCHDOG_JS)
  writeFileSync(join(dir, 'watchdog.sh'), WATCHDOG_SH)
  writeFileSync(
    join(dir, 'parent.cjs'),
    `const { spawn } = require('child_process')
const fs = require('fs')
const [kind, dir] = process.argv.slice(2)
const node = process.execPath
const server = [dir + '/server.cjs', dir + '/server.pid']
const child = kind === 'sh'
  ? spawn('/bin/sh', ['-c', fs.readFileSync(dir + '/watchdog.sh', 'utf8'), 'test', node, ...server], { stdio: ['pipe', 'ignore', 'ignore'], detached: true })
  : spawn(node, [dir + '/watchdog.cjs', String(process.pid), node, ...server], { stdio: ['pipe', 'ignore', 'ignore'], detached: process.platform !== 'win32' })
child.unref()
// Once the server runs, die the hard way: no exit handlers, no cleanup.
const wait = () => (fs.existsSync(dir + '/server.pid') ? process.kill(process.pid, 'SIGKILL') : setTimeout(wait, 50))
wait()
`
  )
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function serverOutlivesParent(kind: 'sh' | 'js'): Promise<boolean> {
  await new Promise<void>((done) => spawn(process.execPath, [join(dir, 'parent.cjs'), kind, dir], { stdio: 'ignore' }).once('exit', () => done()))
  expect(existsSync(join(dir, 'server.pid'))).toBe(true)
  const pid = Number(readFileSync(join(dir, 'server.pid'), 'utf8'))
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100))
  const left = alive(pid)
  if (left) process.kill(pid)
  return left
}

describe('the engine watchdog', () => {
  it.skipIf(process.platform === 'win32')('in sh stops the server when its parent is killed', async () => {
    expect(await serverOutlivesParent('sh')).toBe(false)
  })

  it('in Node stops the server when its parent is killed', async () => {
    expect(await serverOutlivesParent('js')).toBe(false)
  })
})
