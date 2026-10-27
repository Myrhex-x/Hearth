import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chunkText } from '../../src/shared/semantic'
import type { IndexStatus } from '../../src/shared/types'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => paths.userData }, shell: {} }))
vi.mock('../../src/main/llm', () => ({ embed: vi.fn() }))

import { embed } from '../../src/main/llm'
import { SemanticIndex } from '../../src/main/semanticIndex'
import { Workspace } from '../../src/main/workspace'

const MODEL = 'ollama::mock-embed'
// Enough pieces for two batches of 24, so the file is half done when the second batch fails.
const BIG = Array.from({ length: 2000 }, (_, i) => `const line${i} = ${i}`).join('\n')
const PIECES = chunkText(BIG).length
const vectors = async (_model: string, inputs: string[]) => inputs.map((t) => [1 + (t.length % 7), 1, 0.5, 0.25])

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

let project: string
let workspace: Workspace

beforeEach(async () => {
  paths.userData = mkdtempSync(join(tmpdir(), 'hearth-index-data-'))
  project = mkdtempSync(join(tmpdir(), 'hearth-index-project-'))
  writeFileSync(join(project, 'big.js'), BIG)
  workspace = new Workspace(project, () => {})
  await workspace.init()
  vi.mocked(embed).mockReset()
})

afterEach(() => {
  workspace.dispose()
  rmSync(project, { recursive: true, force: true })
  rmSync(paths.userData, { recursive: true, force: true })
})

/** Runs an index until the server fails on the second batch, and saves what it has, like quitting mid-way. */
async function interruptedRun(): Promise<void> {
  vi.mocked(embed).mockImplementationOnce(vectors).mockRejectedValueOnce(new Error('The server went away'))
  let status: IndexStatus | null = null
  const index = new SemanticIndex(workspace, (s) => (status = s))
  await index.configure(MODEL)
  await until(() => status?.state === 'error')
  expect(status!.chunks).toBe(24)
  expect(status!.files).toBe(0)
  await index.dispose()
  await until(() => existsSync(join(paths.userData, 'index')) && savedPieces())
}

function savedPieces(): boolean {
  try {
    const dir = join(paths.userData, 'index')
    return readdirSync(dir).some((d) => JSON.parse(readFileSync(join(dir, d, 'meta.json'), 'utf8')).rows.length > 0)
  } catch {
    return false
  }
}

describe('SemanticIndex', () => {
  it('replaces the pieces of a file that was half indexed instead of keeping both', async () => {
    await interruptedRun()
    vi.mocked(embed).mockImplementation(vectors)
    let status: IndexStatus | null = null
    const index = new SemanticIndex(workspace, (s) => (status = s))
    await index.configure(MODEL)
    await until(() => status?.state === 'ready')
    expect(PIECES).toBeGreaterThan(24)
    expect(status!.files).toBe(1)
    expect(status!.chunks).toBe(PIECES)
    const found = await index.search('line', 50)
    expect(new Set(found.map((r) => r.start)).size).toBe(found.length)
    await index.dispose()
  })

  it('forgets the half-indexed pieces of a file deleted in the meantime', async () => {
    await interruptedRun()
    rmSync(join(project, 'big.js'))
    vi.mocked(embed).mockImplementation(vectors)
    let status: IndexStatus | null = null
    const index = new SemanticIndex(workspace, (s) => (status = s))
    await index.configure(MODEL)
    await until(() => status?.state === 'ready')
    expect(status!.chunks).toBe(0)
    await index.dispose()
  })
})
