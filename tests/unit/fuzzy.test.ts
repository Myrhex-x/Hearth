import { describe, expect, it } from 'vitest'
import { fuzzyFilter } from '../../src/renderer/src/lib/fuzzy'

describe('fuzzy', () => {
  const files = ['src/shared/think.ts', 'src/renderer/src/state/chat.ts', 'src/renderer/src/components/Chat.tsx', 'src/main/index.ts']

  it('ranks a contiguous file name match first', () => {
    expect(fuzzyFilter(files, 'chat.ts', (f) => f)[0].item).toBe('src/renderer/src/state/chat.ts')
  })

  it('matches initials across folders', () => {
    expect(fuzzyFilter(files, 'mainidx', (f) => f)[0].item).toBe('src/main/index.ts')
  })

  it('returns nothing when letters are missing', () => {
    expect(fuzzyFilter(files, 'zzz', (f) => f)).toEqual([])
  })
})
