import { describe, it, expect } from 'vitest'
import { EventBus } from './eventBus'

const flush = () => Promise.resolve()

describe('EventBus', () => {
  it('fires all handlers for an event with args', () => {
    const bus = new EventBus()
    const seen: unknown[] = []
    bus.register('key:right', a => seen.push(a))
    bus.register('key:right', a => seen.push(a))
    bus.fire('key:right', 42)
    expect(seen).toEqual([42, 42])
  })

  it('routes sync and async handler errors to onError without stopping others', async () => {
    const bus = new EventBus()
    const errors: unknown[] = []
    bus.onError = e => errors.push(e)
    let ran = false
    bus.register('start', () => { throw new Error('sync boom') })
    bus.register('start', async () => { throw new Error('async boom') })
    bus.register('start', () => { ran = true })
    bus.fire('start')
    await flush()
    expect(ran).toBe(true)
    expect(errors).toHaveLength(2)
  })

  it('clear removes all handlers', () => {
    const bus = new EventBus()
    let n = 0
    bus.register('update', () => n++)
    bus.clear()
    bus.fire('update')
    expect(n).toBe(0)
  })
})
