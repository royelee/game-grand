import { describe, it, expect, vi } from 'vitest'
import { newProjectId } from './ids'

describe('newProjectId', () => {
  it('is 22 base64url characters, with no padding or non-url characters', () => {
    const id = newProjectId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('does not repeat across many draws', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => newProjectId()))
    expect(seen.size).toBe(1000)
  })

  it('uses Web Crypto, so it works on Workers as well as Node', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    newProjectId()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
