import { describe, it, expect, vi } from 'vitest'
import { RuntimeBridge } from './bridge'
import type { RunPayload } from '../shared/protocol'

const payload: RunPayload = {
  sprites: [], backdrops: [], currentBackdrop: 0, sounds: [], mainScript: '',
}

function setup() {
  const posted: unknown[] = []
  const target = { postMessage: (m: unknown) => posted.push(m) }
  const onIssue = vi.fn()
  const onLog = vi.fn()
  const onStopped = vi.fn()
  const bridge = new RuntimeBridge(target, { onIssue, onLog, onStopped })
  return { bridge, posted, onIssue, onLog, onStopped }
}

describe('RuntimeBridge', () => {
  it('queues run() until the host says ready, then flushes once', () => {
    const { bridge, posted } = setup()
    bridge.run(payload)
    expect(posted).toEqual([])
    bridge.handleMessage({ type: 'ready' })
    expect(posted).toEqual([{ type: 'run', payload }])
    bridge.handleMessage({ type: 'ready' })
    expect(posted).toHaveLength(1)
  })

  it('sends immediately when run() comes after ready', () => {
    const { bridge, posted } = setup()
    bridge.handleMessage({ type: 'ready' })
    bridge.run(payload)
    expect(posted).toEqual([{ type: 'run', payload }])
  })

  it('routes issues, logs, and stopped to handlers', () => {
    const { bridge, onIssue, onLog, onStopped } = setup()
    const issue = { tab: 'Cat', line: 3, message: 'boom' }
    bridge.handleMessage({ type: 'issue', issue })
    bridge.handleMessage({ type: 'log', text: 'hello' })
    bridge.handleMessage({ type: 'stopped' })
    expect(onIssue).toHaveBeenCalledWith(issue)
    expect(onLog).toHaveBeenCalledWith('hello')
    expect(onStopped).toHaveBeenCalledOnce()
  })

  it('ignores foreign messages without throwing', () => {
    const { bridge, onLog } = setup()
    bridge.handleMessage({ source: 'react-devtools-bridge' })
    bridge.handleMessage(undefined)
    expect(onLog).not.toHaveBeenCalled()
  })

  it('drops messages after dispose', () => {
    const { bridge, posted, onLog } = setup()
    bridge.dispose()
    bridge.handleMessage({ type: 'ready' })
    bridge.run(payload)
    bridge.handleMessage({ type: 'log', text: 'x' })
    expect(posted).toEqual([])
    expect(onLog).not.toHaveBeenCalled()
  })
})
