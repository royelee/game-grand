import { describe, it, expect } from 'vitest'
import { newProjectId } from './ids.ts'

describe('newProjectId', () => {
  it('is url-safe and long enough to be unguessable', () => {
    const id = newProjectId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newProjectId()))
    expect(ids.size).toBe(500)
  })
})
