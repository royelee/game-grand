import { describe, it, expect } from 'vitest'
import { keyName } from './keys'

describe('keyName', () => {
  it('maps arrows to Scratch-style names', () => {
    expect(keyName('ArrowRight')).toBe('right')
    expect(keyName('ArrowLeft')).toBe('left')
    expect(keyName('ArrowUp')).toBe('up')
    expect(keyName('ArrowDown')).toBe('down')
  })

  it('maps the space bar and enter', () => {
    expect(keyName(' ')).toBe('space')
    expect(keyName('Enter')).toBe('enter')
  })

  it('lowercases letters and passes digits through', () => {
    expect(keyName('A')).toBe('a')
    expect(keyName('a')).toBe('a')
    expect(keyName('7')).toBe('7')
  })

  it('lowercases anything else it does not know', () => {
    expect(keyName('Escape')).toBe('escape')
  })
})
