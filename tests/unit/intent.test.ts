import { describe, expect, it } from 'vitest'
import { announcesAction } from '../../src/shared/intent'

describe('announcesAction', () => {
  it('spots a reply that ends by promising a change', () => {
    expect(announcesAction("The addItem function sets expires to a Date.\n\nLet's make the necessary changes to the addItem function.")).toBe(true)
    expect(announcesAction("I'll update isExpired so it accepts items without a date.")).toBe(true)
    expect(announcesAction('Now I will run the tests again.')).toBe(true)
    expect(announcesAction('Plan:\n1. Modify addItem.\n2. Test.\n\nLet me apply the fix:')).toBe(true)
  })

  it('leaves finished work and questions alone', () => {
    expect(announcesAction('I changed addItem to store null for items without a date, and all five tests pass.')).toBe(false)
    expect(announcesAction("Let's make the change.\n\nDone: addItem now stores null, and the tests pass.")).toBe(false)
    expect(announcesAction("I can update the README too. Let me know if you'd like that.")).toBe(false)
    expect(announcesAction('Would you like me to fix the other test as well?')).toBe(false)
    expect(announcesAction('')).toBe(false)
  })

  it('counts a promise to look as unfinished, but not one to explain', () => {
    expect(announcesAction("Let's check the expiringWithin function in pantry.js.")).toBe(true)
    expect(announcesAction('I will explain the error first.')).toBe(false)
    expect(announcesAction('Let me summarize what changed.')).toBe(false)
  })
})
