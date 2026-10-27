import { describe, expect, it } from 'vitest'
import { isLooping } from '../../src/shared/loop'

describe('isLooping', () => {
  it('spots a passage repeated over and over', () => {
    const passage = 'So the closing brace is on the same line as the return statement. Therefore the old_text is the return line. '
    expect(isLooping('Let me think. '.repeat(20) + passage.repeat(30))).toBe(true)
  })
  it('leaves ordinary long answers alone', () => {
    const text = Array.from({ length: 200 }, (_, i) => `Line ${i}: step ${i * 7} of the plan, checking item ${i % 13}.`).join('\n')
    expect(isLooping(text)).toBe(false)
  })
  it('ignores short texts', () => {
    expect(isLooping('ok ok ok ok ok ok')).toBe(false)
  })
})
