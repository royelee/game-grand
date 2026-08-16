import { describe, it, expect } from 'vitest'
import { isInternalUrl } from './urlPolicy.js'

const APP = 'https://play.game-grand.workers.dev'

describe('isInternalUrl', () => {
  it('keeps the app’s own pages in the window', () => {
    expect(isInternalUrl(APP, APP)).toBe(true)
    expect(isInternalUrl(`${APP}/`, APP)).toBe(true)
  })

  // Secret links are the whole ownership model — opening a saved game must
  // never bounce the kid out to a browser.
  it('keeps /p/<id> secret links in the window', () => {
    expect(isInternalUrl(`${APP}/p/6Kd2nQ1wRt8vZxAbCdEfGh`, APP)).toBe(true)
  })

  it('sends anything on another host to the real browser', () => {
    expect(isInternalUrl('https://scratch.mit.edu/', APP)).toBe(false)
    expect(isInternalUrl('https://example.com/docs', APP)).toBe(false)
  })

  // origin is scheme + host + port, so all three of these are foreign even
  // though the host matches.
  it('treats a different scheme or port as external', () => {
    expect(isInternalUrl('http://play.game-grand.workers.dev/', APP)).toBe(false)
    expect(isInternalUrl('https://play.game-grand.workers.dev:8443/', APP)).toBe(false)
  })

  it('is false for anything that is not a parseable absolute URL', () => {
    for (const bad of ['', '/p/abc', 'not a url', 'about:blank', 'file:///tmp/x.html']) {
      expect(isInternalUrl(bad, APP), bad).toBe(false)
    }
  })

  // GAME_GRAND_URL points the shell at `make dev` during development.
  it('works for a localhost dev origin', () => {
    const dev = 'http://localhost:5173'
    expect(isInternalUrl(`${dev}/p/abc`, dev)).toBe(true)
    expect(isInternalUrl('http://localhost:8080/api/projects', dev)).toBe(false)
  })
})
