import { describe, it, expect, vi } from 'vitest'
import { RuntimeSession, MAX_DT } from './session'
import type { RunPayload } from '../shared/protocol'

const costume = { name: 'a', width: 20, height: 20, dataUrl: 'data:image/svg+xml,a' }
const backdrop = { name: 'sky', width: 480, height: 360, dataUrl: 'data:image/svg+xml,sky' }

function payload(script: string, mainScript = ''): RunPayload {
  return {
    sprites: [{
      name: 'Cat', x: 0, y: 0, size: 100, direction: 90, visible: true,
      costumes: [costume], currentCostume: 0, script,
    }],
    backdrops: [backdrop],
    currentBackdrop: 0,
    sounds: [{ name: 'meow', dataUrl: 'data:audio/wav,meow' }],
    mainScript,
  }
}

function setup(p: RunPayload) {
  const onIssue = vi.fn()
  const onLog = vi.fn()
  const onStopped = vi.fn()
  const session = new RuntimeSession(p, { onIssue, onLog, onStopped })
  return { session, onIssue, onLog, onStopped }
}

describe('RuntimeSession', () => {
  it('builds sprites from the payload and runs their scripts on start', async () => {
    const { session, onIssue } = setup(payload('onStart(() => { sprite.move(10) })'))
    session.start()
    await Promise.resolve()
    expect(onIssue).not.toHaveBeenCalled()
    expect(session.snapshot().sprites[0].x).toBeCloseTo(10)
  })

  it('applies payload sprite state and the chosen backdrop', () => {
    const p = payload('')
    p.sprites[0].x = 50
    p.sprites[0].size = 150
    p.sprites[0].visible = false
    const { session } = setup(p)
    session.start()
    const snap = session.snapshot()
    expect(snap.sprites[0]).toMatchObject({ x: 50, size: 150, visible: false })
    expect(snap.backdrop).toBe('sky')
  })

  it('reports script issues and logs to the handlers', async () => {
    const { session, onIssue, onLog } = setup(
      payload('onStart(() => {\n  sprite.move("fast")\n})', 'console.log("hi")'),
    )
    session.start()
    await Promise.resolve()
    expect(onLog).toHaveBeenCalledWith('hi')
    expect(onIssue).toHaveBeenCalledOnce()
    expect(onIssue.mock.calls[0][0]).toMatchObject({ tab: 'Cat', line: 2 })
  })

  it('clamps oversized frame deltas', () => {
    const { session } = setup(payload('onUpdate(() => {})'))
    session.start()
    session.step(5)
    expect(session.world.clock.now).toBeCloseTo(MAX_DT)
  })

  it('fires onStopped once when a script calls stopAll', async () => {
    const { session, onStopped } = setup(payload('onStart(() => { stopAll() })'))
    session.start()
    await Promise.resolve()
    session.step(0.016)
    session.step(0.016)
    expect(onStopped).toHaveBeenCalledOnce()
  })

  it('stops ticking the world after stop()', () => {
    const { session } = setup(payload(''))
    session.start()
    session.stop()
    session.step(0.5)
    expect(session.world.clock.now).toBe(0)
  })

  it('forwards input to the world', () => {
    const { session } = setup(payload(''))
    session.start()
    session.keyDown('right')
    expect(session.world.keys.has('right')).toBe(true)
    session.keyUp('right')
    expect(session.world.keys.has('right')).toBe(false)
    session.mouseDown(10, 20)
    expect(session.world.mouse).toMatchObject({ x: 10, y: 20, isDown: true })
    session.mouseUp()
    expect(session.world.mouse.isDown).toBe(false)
  })
})
