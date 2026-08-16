import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('./offline.html', import.meta.url), 'utf8')

describe('offline.html', () => {
  // The whole point of this page is that it renders with no network. A remote
  // font or stylesheet would silently degrade it in exactly the situation it
  // exists for, and nothing on a developer machine would ever show it.
  it('references nothing remote', () => {
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('speaks to a kid about the internet, not about error codes', () => {
    expect(html).toMatch(/internet/i)
    expect(html).not.toMatch(/ERR_|errorCode|net::/)
  })

  // main.ts passes the app URL as a query parameter rather than through a
  // preload bridge — the retry button must read it back.
  it('retries by reading the url query parameter', () => {
    expect(html).toContain('URLSearchParams')
    expect(html).toContain("get('url')")
  })
})
