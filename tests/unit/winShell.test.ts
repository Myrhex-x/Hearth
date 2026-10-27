import { describe, expect, it } from 'vitest'
import { adaptForWindowsPowerShell } from '../../src/shared/winShell'

describe('adaptForWindowsPowerShell', () => {
  it('leaves simple commands alone', () => {
    expect(adaptForWindowsPowerShell('npm test')).toBe('npm test')
  })
  it('turns && into conditional steps', () => {
    expect(adaptForWindowsPowerShell('npm install && npm test')).toBe('npm install; if ($?) { npm test }')
  })
  it('nests longer chains and handles ||', () => {
    expect(adaptForWindowsPowerShell('a && b || c')).toBe('a; if ($?) { b; if (-not $?) { c } }')
  })
  it('ignores && inside quotes', () => {
    expect(adaptForWindowsPowerShell('echo "a && b"')).toBe('echo "a && b"')
    expect(adaptForWindowsPowerShell("git commit -m 'x && y' && git push")).toBe("git commit -m 'x && y'; if ($?) { git push }")
  })
  it('gives up on a dangling operator', () => {
    expect(adaptForWindowsPowerShell('npm test &&')).toBe('npm test &&')
  })
})
