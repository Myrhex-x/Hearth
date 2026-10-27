import path from 'path'
import { describe, expect, it } from 'vitest'
import { isInside, relativeTo, resolveInside } from '../../src/main/paths'

describe('resolveInside (POSIX)', () => {
  const root = '/home/me/project'
  const p = path.posix
  it('resolves relative paths', () => {
    expect(resolveInside(root, 'src/a.ts', p)).toBe('/home/me/project/src/a.ts')
    expect(resolveInside(root, './src/a.ts', p)).toBe('/home/me/project/src/a.ts')
    expect(resolveInside(root, '', p)).toBe(root)
  })
  it('treats a leading slash as the project root', () => {
    expect(resolveInside(root, '/src/a.ts', p)).toBe('/home/me/project/src/a.ts')
  })
  it('accepts absolute paths inside the project', () => {
    expect(resolveInside(root, '/home/me/project/README.md', p)).toBe('/home/me/project/README.md')
  })
  it('refuses to escape the project', () => {
    expect(() => resolveInside(root, '../secret', p)).toThrow(/outside/)
    expect(() => resolveInside(root, 'src/../../x', p)).toThrow(/outside/)
  })
  it('allows names that start with two dots', () => {
    expect(resolveInside(root, '..config', p)).toBe('/home/me/project/..config')
  })
})

describe('resolveInside (Windows)', () => {
  const root = 'C:\\Users\\me\\project'
  const w = path.win32
  it('accepts forward and back slashes', () => {
    expect(resolveInside(root, 'src/a.ts', w)).toBe('C:\\Users\\me\\project\\src\\a.ts')
    expect(resolveInside(root, 'src\\a.ts', w)).toBe('C:\\Users\\me\\project\\src\\a.ts')
  })
  it('accepts absolute paths inside the project, whatever the case', () => {
    expect(resolveInside(root, 'c:\\users\\me\\project\\b.ts', w).toLowerCase()).toBe('c:\\users\\me\\project\\b.ts')
  })
  it('refuses other drives and parent folders', () => {
    expect(() => resolveInside(root, 'D:\\other\\x', w)).toThrow(/outside/)
    expect(() => resolveInside(root, '..\\x', w)).toThrow(/outside/)
  })
  it('turns native relative paths into forward slashes', () => {
    expect(relativeTo(root, 'C:\\Users\\me\\project\\src\\a.ts', w)).toBe('src/a.ts')
    expect(isInside(root, 'C:\\Users\\me\\project2', w)).toBe(false)
  })
})

describe('Windows file names', () => {
  const root = 'C:\\Users\\me\\project'
  const w = path.win32
  it('rejects names Windows cannot store', () => {
    expect(() => resolveInside(root, 'notes: draft.md', w)).toThrow(/not a valid file name/)
    expect(() => resolveInside(root, 'src/nul.ts', w)).toThrow(/not a valid file name/)
    expect(() => resolveInside(root, 'CON', w)).toThrow(/not a valid file name/)
    expect(() => resolveInside(root, 'draft.', w)).toThrow(/not a valid file name/)
  })
  it('still accepts ordinary names', () => {
    expect(resolveInside(root, 'src/console.ts', w)).toBe('C:\\Users\\me\\project\\src\\console.ts')
    expect(resolveInside(root, 'my file (2).txt', w)).toBe('C:\\Users\\me\\project\\my file (2).txt')
  })
  it('works for a project at the root of a drive', () => {
    expect(resolveInside('D:\\', 'src/a.ts', w)).toBe('D:\\src\\a.ts')
    expect(relativeTo('D:\\', 'D:\\src\\a.ts', w)).toBe('src/a.ts')
  })
})
