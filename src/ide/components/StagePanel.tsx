import { useEffect, useRef } from 'react'
import { RuntimeBridge } from '../bridge'
import type { RunPayload } from '../../shared/protocol'
import type { ScriptIssue } from '../../runtime/executor'

interface Props {
  runId: number
  running: boolean
  payload: RunPayload | null
  onIssue: (issue: ScriptIssue) => void
  onLog: (text: string) => void
  onStopped: () => void
}

/**
 * Mounts the sandboxed runtime iframe. The `key={runId}` on this component's
 * iframe is load-bearing: a new run must get a brand-new document, because the
 * engine's Executor cannot be re-run against an existing World.
 */
export function StagePanel({ runId, running, payload, onIssue, onLog, onStopped }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const bridgeRef = useRef<RuntimeBridge | null>(null)

  useEffect(() => {
    if (!running || !payload) return
    const target = frameRef.current?.contentWindow
    if (!target) return

    const bridge = new RuntimeBridge(target, { onIssue, onLog, onStopped })
    bridgeRef.current = bridge
    const listener = (event: MessageEvent) => {
      if (event.source === target) bridge.handleMessage(event.data)
    }
    window.addEventListener('message', listener)
    bridge.run(payload)
    return () => {
      window.removeEventListener('message', listener)
      bridge.dispose()
      bridgeRef.current = null
    }
  }, [runId, running, payload, onIssue, onLog, onStopped])

  return (
    <div className="stage-frame">
      {running ? (
        <iframe
          key={runId}
          ref={frameRef}
          src="/runtime.html"
          title="Game stage"
          sandbox="allow-scripts"
          // Belt and braces for the ready handshake: if the iframe's script
          // ran (and posted `ready`) before this effect attached its listener,
          // the load event still guarantees delivery. RuntimeBridge ignores a
          // second `ready`, so at most one run payload is ever sent.
          onLoad={() => bridgeRef.current?.handleMessage({ type: 'ready' })}
        />
      ) : (
        <div className="stage-empty">Press Run to play your game</div>
      )}
    </div>
  )
}
