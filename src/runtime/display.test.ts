import { describe, it, expect } from 'vitest'
import { display } from './display'

describe('display', () => {
  it('stringifies plain objects and arrays as JSON', () => {
    expect(display({ a: 1 })).toBe('{"a":1}')
    expect(display([1, 2, 3])).toBe('[1,2,3]')
  })

  it('uses String() for everything else', () => {
    expect(display(42)).toBe('42')
    expect(display('hi')).toBe('hi')
    expect(display(true)).toBe('true')
    expect(display(undefined)).toBe('undefined')
    expect(display(null)).toBe('null')
  })
})
