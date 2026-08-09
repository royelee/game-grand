import { describe, it, expect } from 'vitest'
import { isOpaqueOrigin } from './sandboxGuard'

describe('isOpaqueOrigin', () => {
  it('accepts the opaque "null" origin a sandboxed iframe gets', () => {
    expect(isOpaqueOrigin('null')).toBe(true)
  })

  it('rejects a real origin, e.g. an embedder that omitted the sandbox attribute', () => {
    expect(isOpaqueOrigin('https://evil.example')).toBe(false)
    expect(isOpaqueOrigin('http://localhost:5173')).toBe(false)
    expect(isOpaqueOrigin('')).toBe(false)
  })
})
