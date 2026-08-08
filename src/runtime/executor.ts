import { World } from './world'
import { makeSpriteApi, type SpriteApi } from './spriteApi'
import type { SpriteModel } from './spriteModel'
import { FriendlyError, expectFunction, expectNumber, expectString } from './errors'

export interface RunProject {
  mainScript: string
  spriteScripts: { name: string; script: string }[]
}

export interface ScriptIssue {
  tab: string
  line: number | null
  message: string
}

// new Function('__g', 'with (__g) {\n' + src + '\n}') produces:
//   line 1: function anonymous(__g
//   line 2: ) {
//   line 3: with (__g) {
//   line 4: <user line 1>
const LINE_OFFSET = 3

// Wraps a script's globals object so that `with (sandbox) { ... }` never lets
// undeclared assignments (`score = 5`, no `let`/`const`) leak onto the shared
// realm's globalThis. Reads still fall through to real globals (Math, etc.);
// writes always land on the per-script object; unknown reads raise a
// ReferenceError like native JS would.
function makeSandbox(g: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(g, {
    has: () => true,
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined
      if (k in t) return (t as Record<PropertyKey, unknown>)[k]
      if (k in globalThis) return (globalThis as Record<PropertyKey, unknown>)[k]
      throw new ReferenceError(`${String(k)} is not defined`)
    },
    set: (t, k, v) => {
      ;(t as Record<PropertyKey, unknown>)[k] = v
      return true
    },
  })
}

function lineFromStack(err: unknown): number | null {
  const stack = err instanceof Error ? err.stack ?? '' : ''
  const m = stack.match(/<anonymous>:(\d+):/)
  if (!m) return null
  const line = parseInt(m[1], 10) - LINE_OFFSET
  return line >= 1 ? line : null
}

export class Executor {
  private sharedGlobalNames: string[] = []

  constructor(
    private world: World,
    private opts: { onIssue: (i: ScriptIssue) => void; onLog: (msg: string) => void },
  ) {}

  private report(tab: string, err: unknown): void {
    const message =
      err instanceof FriendlyError ? err.message : err instanceof Error ? err.message : String(err)
    this.opts.onIssue({ tab, line: lineFromStack(err), message })
  }

  private wrap(tab: string, fn: Function): (...args: unknown[]) => unknown {
    return (...args: unknown[]) => {
      try {
        const r = fn(...args)
        if (r instanceof Promise) return r.catch(err => this.report(tab, err))
        return r
      } catch (err) {
        this.report(tab, err)
      }
    }
  }

  private buildShared(tab: string, vars: Record<string, unknown>): Record<string, unknown> {
    const w = this.world
    const on = (event: string) => (fn: unknown) => {
      w.bus.register(event, this.wrap(tab, expectFunction('on…', 'onStart(() => { ... })', fn)))
    }
    const g: Record<string, unknown> = {
      vars,
      wait: (secs: unknown) => w.clock.wait(expectNumber('wait', 'wait(1)', secs)),
      broadcast: (name: unknown) => w.broadcast(name),
      onStart: (fn: unknown) =>
        w.bus.register('start', this.wrap(tab, expectFunction('onStart', 'onStart(() => { ... })', fn))),
      onKeyPress: (key: unknown, fn: unknown) =>
        w.bus.register(
          `key:${expectString('onKeyPress', 'onKeyPress("right", () => { ... })', key)}`,
          this.wrap(tab, expectFunction('onKeyPress', 'onKeyPress("right", () => { ... })', fn)),
        ),
      onMessage: (name: unknown, fn: unknown) =>
        w.bus.register(
          `message:${expectString('onMessage', 'onMessage("go", () => { ... })', name)}`,
          this.wrap(tab, expectFunction('onMessage', 'onMessage("go", () => { ... })', fn)),
        ),
      onUpdate: (fn: unknown) =>
        w.bus.register('update', this.wrap(tab, expectFunction('onUpdate', 'onUpdate(() => { ... })', fn))),
      onBackdropSwitch: (name: unknown, fn: unknown) =>
        w.bus.register(
          `backdrop:${expectString('onBackdropSwitch', 'onBackdropSwitch("sky", () => { ... })', name)}`,
          this.wrap(tab, expectFunction('onBackdropSwitch', 'onBackdropSwitch("sky", () => { ... })', fn)),
        ),
      keyIsDown: (key: unknown) =>
        w.keys.has(expectString('keyIsDown', 'keyIsDown("right")', key)),
      // Read-only view: scripts must not be able to mutate world.mouse directly.
      mouse: {
        get x() { return w.mouse.x },
        get y() { return w.mouse.y },
        get isDown() { return w.mouse.isDown },
      },
      resetTimer: () => w.resetTimer(),
      stage: {
        switchBackdrop: (name: unknown) => w.stage.switchBackdrop(name),
        nextBackdrop: () => w.stage.nextBackdrop(),
      },
      playSound: (name: unknown) => w.playSound(name),
      playSoundUntilDone: (name: unknown) => w.playSoundUntilDone(name),
      setVolume: (n: unknown) => {
        w.volume = Math.min(100, Math.max(0, expectNumber('setVolume', 'setVolume(50)', n)))
      },
      watch: (name: unknown) => {
        const n = expectString('watch', 'watch("score")', name)
        w.watches.push({ name: n, get: () => vars[n] })
      },
      stopAll: () => w.stopAll(),
      console: {
        log: (...args: unknown[]) => this.opts.onLog(args.map(a => String(a)).join(' ')),
      },
    }
    Object.defineProperty(g, 'timer', { get: () => w.timer, enumerable: true })
    this.sharedGlobalNames = Object.keys(g)
    return g
  }

  globalNames(): string[] {
    if (this.sharedGlobalNames.length === 0) this.buildShared('main', {})
    return [...this.sharedGlobalNames, 'sprite', 'onClick', 'onCloneStart', 'sprites']
  }

  private compileAndRun(tab: string, source: string, globals: Record<string, unknown>): void {
    let fn: Function
    try {
      fn = new Function('__g', 'with (__g) {\n' + source + '\n}')
    } catch (err) {
      this.report(tab, err)
      return
    }
    try {
      fn(makeSandbox(globals))
    } catch (err) {
      this.report(tab, err)
    }
  }

  run(project: RunProject): void {
    const vars: Record<string, unknown> = {}
    const facades = new Map<string, SpriteApi>()
    for (const m of this.world.sprites) {
      if (!m.isClone) facades.set(m.name, makeSpriteApi(m, this.world))
    }

    // Never spread buildShared()'s result: spreading would copy the live
    // `timer` getter as a frozen value. Assign extras onto the object instead.
    const mainGlobals = this.buildShared('main', vars)
    mainGlobals.sprites = Object.fromEntries(facades)
    this.compileAndRun('main', project.mainScript, mainGlobals)

    for (const { name, script } of project.spriteScripts) {
      const facade = facades.get(name)
      if (!facade) continue
      const g = this.buildShared(name, vars)
      g.sprite = facade
      g.onClick = (fn: unknown) =>
        this.world.bus.register(
          `click:${name}`,
          this.wrap(name, expectFunction('onClick', 'onClick(() => { ... })', fn)),
        )
      g.onCloneStart = (fn: unknown) => {
        const user = expectFunction('onCloneStart', 'onCloneStart(clone => { ... })', fn)
        this.world.bus.register(
          `clone:${name}`,
          this.wrap(name, (cloneModel: unknown) =>
            user(makeSpriteApi(cloneModel as SpriteModel, this.world)),
          ),
        )
      }
      this.compileAndRun(name, script, g)
    }

    this.world.bus.fire('start')
  }
}
