import { isHostMessage, type RunPayload } from '../shared/protocol'
import type { ScriptIssue } from '../runtime/executor'

export interface BridgeHandlers {
  onIssue: (issue: ScriptIssue) => void
  onLog: (text: string) => void
  onStopped: () => void
}

export interface PostTarget {
  postMessage(message: unknown, targetOrigin: string): void
}

/**
 * Parent side of the iframe protocol. Holds a run payload until the host
 * reports `ready`, because the iframe's scripts may not have parsed yet when
 * the user hits Run.
 */
export class RuntimeBridge {
  private ready = false
  private pending: RunPayload | null = null
  private disposed = false

  constructor(
    private target: PostTarget,
    private handlers: BridgeHandlers,
  ) {}

  run(payload: RunPayload): void {
    if (this.disposed) return
    if (this.ready) this.send(payload)
    else this.pending = payload
  }

  handleMessage(data: unknown): void {
    if (this.disposed || !isHostMessage(data)) return
    switch (data.type) {
      case 'ready':
        if (this.ready) return
        this.ready = true
        if (this.pending) {
          const p = this.pending
          this.pending = null
          this.send(p)
        }
        return
      case 'issue':
        return this.handlers.onIssue(data.issue)
      case 'log':
        return this.handlers.onLog(data.text)
      case 'stopped':
        return this.handlers.onStopped()
    }
  }

  dispose(): void {
    this.disposed = true
    this.pending = null
  }

  private send(payload: RunPayload): void {
    // targetOrigin '*': the sandboxed iframe has an opaque origin, so no
    // specific origin can be named. Nothing secret travels this direction.
    this.target.postMessage({ type: 'run', payload }, '*')
  }
}
