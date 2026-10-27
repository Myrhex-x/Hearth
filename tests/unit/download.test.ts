import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { downloadFile } from '../../src/main/engine/download'

const SIZE = 600_000
const bytes = Buffer.alloc(SIZE)
for (let i = 0; i < SIZE; i++) bytes[i] = (i * 7 + 3) % 256
const sha256 = createHash('sha256').update(bytes).digest('hex')

let server: http.Server
let base: string
let ranges: string[] = []
/** 'ok', or a server that ignores Range and always sends everything. */
let mode: 'ok' | 'no-range' = 'ok'

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const range = req.headers.range ?? ''
    ranges.push(range)
    const from = mode === 'ok' ? Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0) : 0
    res.writeHead(from ? 206 : 200, { 'content-length': String(SIZE - from) })
    // In pieces, slowly enough for a test to stop it half way.
    for (let at = from; at < SIZE; at += 50_000) {
      if (!res.write(bytes.subarray(at, Math.min(SIZE, at + 50_000)))) await new Promise((r) => res.once('drain', r))
      await new Promise((r) => setTimeout(r, 5))
    }
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hearth-download-'))
  ranges = []
  mode = 'ok'
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('downloadFile', () => {
  it('downloads, checks the checksum and gives the file its name', async () => {
    const dest = join(dir, 'model.gguf')
    let last = 0
    await downloadFile({ url: `${base}/m`, dest, size: SIZE, sha256, onProgress: (n) => (last = n) })
    expect(readFileSync(dest).equals(bytes)).toBe(true)
    expect(existsSync(dest + '.part')).toBe(false)
    expect(last).toBe(SIZE)
  })

  it('continues where a stopped download left off', async () => {
    const dest = join(dir, 'model.gguf')
    const stop = new AbortController()
    await expect(
      downloadFile({ url: `${base}/m`, dest, size: SIZE, sha256, signal: stop.signal, onProgress: (n) => n > 200_000 && stop.abort() })
    ).rejects.toThrow()
    const kept = statSync(dest + '.part').size
    expect(kept).toBeGreaterThan(200_000)
    expect(kept).toBeLessThan(SIZE)
    await downloadFile({ url: `${base}/m`, dest, size: SIZE, sha256 })
    expect(ranges.at(-1)).toBe(`bytes=${kept}-`)
    expect(readFileSync(dest).equals(bytes)).toBe(true)
  })

  it('starts over when the server sends the whole file instead of the rest', async () => {
    const dest = join(dir, 'model.gguf')
    writeFileSync(dest + '.part', bytes.subarray(0, 100_000))
    mode = 'no-range'
    await downloadFile({ url: `${base}/m`, dest, size: SIZE, sha256 })
    expect(readFileSync(dest).equals(bytes)).toBe(true)
  })

  it('deletes a file that does not match its checksum', async () => {
    const dest = join(dir, 'model.gguf')
    await expect(downloadFile({ url: `${base}/m`, dest, size: SIZE, sha256: '0'.repeat(64) })).rejects.toThrow(/checksum/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(dest + '.part')).toBe(false)
  })

  it('does nothing for a file that is already complete', async () => {
    const dest = join(dir, 'model.gguf')
    writeFileSync(dest, bytes)
    await downloadFile({ url: `${base}/m`, dest, size: SIZE, sha256 })
    expect(ranges).toHaveLength(0)
  })
})
