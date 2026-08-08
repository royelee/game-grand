import { describe, it, expect } from 'vitest'
import { FriendlyError, expectNumber, expectString, expectFunction } from './errors'

describe('validators', () => {
  it('passes valid values through', () => {
    expect(expectNumber('move', 'sprite.move(10)', 5)).toBe(5)
    expect(expectString('broadcast', 'broadcast("go")', 'go')).toBe('go')
    const fn = () => {}
    expect(expectFunction('onStart', 'onStart(() => { ... })', fn)).toBe(fn)
  })

  it('throws a FriendlyError with example and received value', () => {
    try {
      expectNumber('move', 'sprite.move(10)', 'fast')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(FriendlyError)
      const msg = (e as Error).message
      expect(msg).toContain('`move` needs a number')
      expect(msg).toContain('sprite.move(10)')
      expect(msg).toContain('"fast"')
    }
  })

  it('rejects NaN and undefined as numbers', () => {
    expect(() => expectNumber('wait', 'wait(1)', NaN)).toThrow(FriendlyError)
    expect(() => expectNumber('wait', 'wait(1)', undefined)).toThrow(/nothing/)
  })
})
