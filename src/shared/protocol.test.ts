import { describe, it, expect } from 'vitest'
import { isHostMessage, isIdeMessage } from './protocol'

describe('protocol guards', () => {
  it('accepts well-formed host messages', () => {
    expect(isHostMessage({ type: 'ready' })).toBe(true)
    expect(isHostMessage({ type: 'log', text: 'hi' })).toBe(true)
    expect(isHostMessage({ type: 'issue', issue: { tab: 'Cat', line: 2, message: 'boom' } })).toBe(true)
    expect(isHostMessage({ type: 'stopped' })).toBe(true)
  })

  it('rejects junk, foreign postMessage noise, and wrong shapes', () => {
    expect(isHostMessage(null)).toBe(false)
    expect(isHostMessage('ready')).toBe(false)
    expect(isHostMessage({ type: 'unknown' })).toBe(false)
    expect(isHostMessage({ type: 'log' })).toBe(false)
    expect(isHostMessage({ type: 'issue', issue: { tab: 'Cat' } })).toBe(false)
    expect(isHostMessage({ source: 'react-devtools-bridge' })).toBe(false)
  })

  it('recognizes ide messages', () => {
    expect(isIdeMessage({ type: 'run', payload: { sprites: [], backdrops: [], currentBackdrop: 0, sounds: [], mainScript: '' } })).toBe(true)
    expect(isIdeMessage({ type: 'run' })).toBe(false)
  })
})
