import { describe, it, expect } from 'vitest'
import { Clock } from './clock'

const flush = () => Promise.resolve()

describe('Clock', () => {
  it('advances now by dt', () => {
    const c = new Clock()
    c.tick(0.5)
    c.tick(0.25)
    expect(c.now).toBeCloseTo(0.75)
  })

  it('resolves wait only after enough time has passed', async () => {
    const c = new Clock()
    let done = false
    c.wait(1).then(() => { done = true })
    c.tick(0.5); await flush()
    expect(done).toBe(false)
    c.tick(0.6); await flush()
    expect(done).toBe(true)
  })

  it('calls frame callbacks with dt and honors unsubscribe', () => {
    const c = new Clock()
    const dts: number[] = []
    const unsub = c.onFrame(dt => dts.push(dt))
    c.tick(0.1)
    unsub()
    c.tick(0.2)
    expect(dts).toEqual([0.1])
  })

  it('clearAll abandons pending waits and frame callbacks', async () => {
    const c = new Clock()
    let done = false
    c.wait(1).then(() => { done = true })
    let frames = 0
    c.onFrame(() => frames++)
    c.clearAll()
    c.tick(2); await flush()
    expect(done).toBe(false)
    expect(frames).toBe(0)
  })
})
