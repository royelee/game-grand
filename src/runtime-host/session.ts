import { World } from '../runtime/world'
import { Executor, type ScriptIssue } from '../runtime/executor'
import type { RunPayload } from '../shared/protocol'

/**
 * One frame delta can be enormous after a background tab wakes up. Without a
 * clamp, every glide completes in a single step and fast sprites tunnel
 * through each other.
 */
export const MAX_DT = 0.1

export interface SessionHandlers {
  onIssue: (issue: ScriptIssue) => void
  onLog: (text: string) => void
  onStopped: () => void
}

export class RuntimeSession {
  readonly world: World
  private executor: Executor
  private started = false
  private halted = false

  constructor(
    private payload: RunPayload,
    private handlers: SessionHandlers,
  ) {
    this.world = new World({
      backdrops: payload.backdrops.map(b => ({
        name: b.name, width: b.width, height: b.height, source: b.dataUrl,
      })),
      soundNames: payload.sounds.map(s => s.name),
    })
    this.world.stage.currentBackdrop = payload.currentBackdrop
    for (const s of payload.sprites) {
      const model = this.world.addSprite(
        s.name,
        s.costumes.map(c => ({
          name: c.name, width: c.width, height: c.height, source: c.dataUrl,
        })),
      )
      model.place(s.x, s.y)
      model.size = s.size
      model.direction = s.direction
      model.visible = s.visible
      model.currentCostume = s.currentCostume
    }
    this.executor = new Executor(this.world, {
      onIssue: issue => this.handlers.onIssue(issue),
      onLog: text => this.handlers.onLog(text),
    })
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.executor.run({
      mainScript: this.payload.mainScript,
      spriteScripts: this.payload.sprites.map(s => ({ name: s.name, script: s.script })),
    })
    this.checkHalted()
  }

  step(dtSeconds: number): void {
    if (!this.started || this.halted) return
    this.world.tick(Math.min(dtSeconds, MAX_DT))
    this.checkHalted()
  }

  snapshot() {
    return this.world.snapshot()
  }

  stop(): void {
    if (this.halted) return
    this.halted = true
    this.world.stopAll()
  }

  keyDown(key: string): void {
    this.world.keyDown(key)
  }
  keyUp(key: string): void {
    this.world.keyUp(key)
  }
  mouseMove(x: number, y: number): void {
    this.world.mouseMove(x, y)
  }
  mouseDown(x: number, y: number): void {
    this.world.mouseDown(x, y)
  }
  mouseUp(): void {
    this.world.mouseUp()
  }
  clickAt(x: number, y: number): void {
    this.world.clickAt(x, y)
  }

  /** A script calling stopAll() flips world.running; tell the parent once. */
  private checkHalted(): void {
    if (this.halted || this.world.running) return
    this.halted = true
    this.handlers.onStopped()
  }
}
