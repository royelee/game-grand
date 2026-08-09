import { describe, it, expect } from 'vitest'
import { buildApp } from './app.ts'

describe('server', () => {
  it('answers a health check', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    await app.close()
  })

  it('returns a readable 404 for an unknown api route', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/not found/i)
    await app.close()
  })
})
