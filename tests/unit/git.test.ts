import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { gitChangeSummary, gitCommit, gitDiscard, gitShowHead, gitStage, gitStatus, gitUnstage, parseStatus } from '../../src/main/git'

const SAMPLE = [
  '# branch.oid 1ff078906b7cd450305e2f87bcdcb4d0ce984fef',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 7898192 7898192 pkg/a.txt',
  '2 R. N... 100644 100644 100644 587be6b 587be6b R100 pkg/renamed.txt',
  'pkg/sp ace é.txt',
  '1 MM N... 100644 100644 100644 aaa bbb pkg/with space.ts',
  'u UU N... 100644 100644 100644 100644 a b c pkg/conflict.ts',
  '? pkg/sub/new.txt',
  '? outside.txt',
  ''
].join('\0')

describe('parseStatus', () => {
  it('reads the branch, upstream and ahead/behind counts', () => {
    const s = parseStatus(SAMPLE, '')
    expect(s).toMatchObject({ branch: 'main', head: '1ff078906b7cd450305e2f87bcdcb4d0ce984fef', upstream: 'origin/main', ahead: 2, behind: 1 })
  })

  it('maps paths to the open subfolder and drops files outside it', () => {
    const s = parseStatus(SAMPLE, 'pkg/')
    expect(s.files.map((f) => f.path)).toEqual(['a.txt', 'conflict.ts', 'renamed.txt', 'sub/new.txt', 'with space.ts'])
  })

  it('classifies every kind of change', () => {
    const byPath = Object.fromEntries(parseStatus(SAMPLE, 'pkg/').files.map((f) => [f.path, f]))
    expect(byPath['a.txt']).toMatchObject({ kind: 'modified', staged: false, unstaged: true })
    expect(byPath['renamed.txt']).toMatchObject({ kind: 'renamed', staged: true, unstaged: false, origPath: 'sp ace é.txt' })
    expect(byPath['with space.ts']).toMatchObject({ kind: 'modified', staged: true, unstaged: true })
    expect(byPath['conflict.ts']).toMatchObject({ kind: 'conflict', staged: false, unstaged: true })
    expect(byPath['sub/new.txt']).toMatchObject({ kind: 'untracked', unstaged: true })
  })

  it('handles a repository without commits or a branch', () => {
    const s = parseStatus(['# branch.oid (initial)', '# branch.head (detached)', ''].join('\0'), '')
    expect(s.head).toBeNull()
    expect(s.branch).toBeNull()
  })
})

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'])
    return true
  } catch {
    return false
  }
}

describe.skipIf(!hasGit())('git commands on a real repository', () => {
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hearth-git-'))
    const g = (...args: string[]) => execFileSync('git', args, { cwd: dir })
    g('init', '-q')
    g('config', 'user.email', 'test@example.com')
    g('config', 'user.name', 'Test')
    g('config', 'core.autocrlf', 'false')
    mkdirSync(join(dir, 'app'))
    writeFileSync(join(dir, 'app', 'main.js'), 'console.log(1)\n')
    writeFileSync(join(dir, 'README.md'), '# demo\n')
    g('add', '-A')
    g('commit', '-q', '-m', 'first')
    return dir
  }

  it('reports, stages, unstages and commits changes', async () => {
    const dir = repo()
    writeFileSync(join(dir, 'app', 'main.js'), 'console.log(2)\n')
    writeFileSync(join(dir, 'app', 'new file.js'), 'export {}\n')

    let s = await gitStatus(dir)
    expect(s.isRepo).toBe(true)
    expect(s.files.map((f) => `${f.kind}:${f.path}`)).toEqual(['modified:app/main.js', 'untracked:app/new file.js'])

    await gitStage(dir, ['app/new file.js'])
    s = await gitStatus(dir)
    expect(s.files.find((f) => f.path === 'app/new file.js')).toMatchObject({ kind: 'added', staged: true })

    await gitUnstage(dir, ['app/new file.js'])
    s = await gitStatus(dir)
    expect(s.files.find((f) => f.path === 'app/new file.js')).toMatchObject({ kind: 'untracked', staged: false })

    const summary = await gitChangeSummary(dir)
    expect(summary.staged).toBe(false)
    expect(summary.diff).toContain('+console.log(2)')
    expect(summary.untracked).toContain('app/new file.js')
    expect(summary.recent).toEqual(['first'])

    const commit = await gitCommit(dir, 'Update main\n\nWith a body line.', true)
    expect(commit).toMatch(/Update main$/)
    s = await gitStatus(dir)
    expect(s.files).toEqual([])
  })

  it('reads the committed version and discards edits', async () => {
    const dir = repo()
    expect(await gitShowHead(dir, 'app/main.js')).toBe('console.log(1)\n')
    expect(await gitShowHead(dir, 'app/missing.js')).toBeNull()
    writeFileSync(join(dir, 'app', 'main.js'), 'broken\n')
    await gitDiscard(dir, ['app/main.js'])
    expect(readFileSync(join(dir, 'app', 'main.js'), 'utf8')).toBe('console.log(1)\n')
  })

  it('works when the open folder is a subfolder of the repository', async () => {
    const dir = repo()
    const sub = join(dir, 'app')
    writeFileSync(join(sub, 'main.js'), 'console.log(3)\n')
    writeFileSync(join(dir, 'README.md'), '# changed outside\n')
    const s = await gitStatus(sub)
    expect(s.files.map((f) => f.path)).toEqual(['main.js'])
    expect(await gitShowHead(sub, 'main.js')).toBe('console.log(1)\n')
  })

  it('says so when a folder is not a repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hearth-nogit-'))
    const s = await gitStatus(dir)
    expect(s.isRepo).toBe(false)
  })
})
