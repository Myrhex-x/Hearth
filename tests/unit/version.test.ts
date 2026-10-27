import { describe, expect, it } from 'vitest'
import { isNewer } from '../../src/shared/version'

describe('isNewer', () => {
  it('compares versions number by number', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('v0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.1.0', '0.2.0')).toBe(false)
    expect(isNewer('1.0', '0.9.9')).toBe(true)
  })
  it('treats a pre-release as older than the release', () => {
    expect(isNewer('0.2.0', '0.2.0-beta.1')).toBe(true)
    expect(isNewer('0.2.0-beta.1', '0.2.0')).toBe(false)
  })
})
