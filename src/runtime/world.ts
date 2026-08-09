import { Clock } from './clock'
import { EventBus } from './eventBus'
import { StageModel } from './stageModel'
import { SpriteModel, type Costume } from './spriteModel'
import { bounds } from './sensing'
import { FriendlyError, expectString } from './errors'
import { display } from './display'
import { PenLayer } from './pen'

export interface WatchEntry {
  name: string
  get: () => unknown
}

export interface WorldOptions {
  backdrops: Costume[]
  soundNames: string[]
}

export class World {
  clock = new Clock()
  bus = new EventBus()
  stage: StageModel
  sprites: SpriteModel[] = []
  keys = new Set<string>()
  mouse = { x: 0, y: 0, isDown: false }
  volume = 100
  watches: WatchEntry[] = []
  penLayer = new PenLayer()
  running = true

  private soundNames: string[]
  private soundId = 0
  private soundQueue: { id: number; name: string }[] = []
  private pendingSounds = new Map<number, () => void>()
  private timerStart = 0
  private nextSpriteId = 1

  constructor(opts: WorldOptions) {
    this.stage = new StageModel(opts.backdrops)
    this.soundNames = opts.soundNames
    this.stage.onBackdropChange = name => this.bus.fire(`backdrop:${name}`)
  }

  addSprite(name: string, costumes: Costume[]): SpriteModel {
    const s = new SpriteModel(name, costumes, this.clock, this.nextSpriteId++, this.penLayer)
    this.sprites.push(s)
    return s
  }

  get timer(): number {
    return this.clock.now - this.timerStart
  }

  resetTimer(): void {
    this.timerStart = this.clock.now
  }

  broadcast(name: unknown): void {
    const n = expectString('broadcast', 'broadcast("go")', name)
    this.bus.fire(`message:${n}`)
  }

  goToFront(s: SpriteModel): void {
    this.sprites = this.sprites.filter(x => x !== s)
    this.sprites.push(s)
  }

  goBack(s: SpriteModel, n: number): void {
    const from = this.sprites.indexOf(s)
    if (from === -1) return
    this.sprites.splice(from, 1)
    this.sprites.splice(Math.max(0, from - n), 0, s)
  }

  clone(src: SpriteModel): SpriteModel {
    const c = new SpriteModel(src.name, src.costumes, this.clock, this.nextSpriteId++, this.penLayer)
    // Placed before the pen state is copied: a fresh PenState is pen-up, so
    // spawning a clone never draws a line from wherever the last sprite was.
    c.place(src.x, src.y)
    c.direction = src.direction
    c.size = src.size
    c.visible = src.visible
    c.rotationStyle = src.rotationStyle
    c.currentCostume = src.currentCostume
    c.effects = { ...src.effects }
    c.pen.copyFrom(src.pen)
    c.isClone = true
    this.sprites.push(c)
    this.bus.fire(`clone:${src.name}`, c)
    return c
  }

  removeClone(s: SpriteModel): void {
    if (!s.isClone) return
    s.deleted = true
    this.sprites = this.sprites.filter(x => x !== s)
  }

  stopAll(): void {
    this.running = false
    this.clock.clearAll()
    this.bus.clear()
    for (const resolve of this.pendingSounds.values()) resolve()
    this.pendingSounds.clear()
  }

  tick(dt: number): void {
    if (!this.running) return
    this.bus.fire('update', dt)
    this.clock.tick(dt)
  }

  keyDown(key: string): void {
    this.keys.add(key)
    this.bus.fire(`key:${key}`)
  }

  keyUp(key: string): void {
    this.keys.delete(key)
  }

  mouseMove(x: number, y: number): void {
    this.mouse.x = x
    this.mouse.y = y
  }

  mouseDown(x: number, y: number): void {
    this.mouse.x = x
    this.mouse.y = y
    this.mouse.isDown = true
  }

  mouseUp(): void {
    this.mouse.isDown = false
  }

  clickAt(x: number, y: number): void {
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i]
      if (!s.visible || s.deleted) continue
      const b = bounds(s)
      if (x >= b.left && x <= b.right && y >= b.bottom && y <= b.top) {
        this.bus.fire(`click:${s.name}`)
        return
      }
    }
  }

  private validateSound(fn: string, name: unknown): string {
    const n = expectString(fn, `${fn}("${this.soundNames[0] ?? 'meow'}")`, name)
    if (!this.soundNames.includes(n)) {
      const names = this.soundNames.map(s => `"${s}"`).join(', ')
      throw new FriendlyError(
        `\`${fn}\` couldn't find a sound called "${n}". This project's sounds are: ${names}.`,
      )
    }
    return n
  }

  playSound(name: unknown): void {
    const n = this.validateSound('playSound', name)
    this.soundQueue.push({ id: ++this.soundId, name: n })
  }

  playSoundUntilDone(name: unknown): Promise<void> {
    const n = this.validateSound('playSoundUntilDone', name)
    const id = ++this.soundId
    this.soundQueue.push({ id, name: n })
    return new Promise(resolve => this.pendingSounds.set(id, resolve))
  }

  soundFinished(id: number): void {
    this.pendingSounds.get(id)?.()
    this.pendingSounds.delete(id)
  }

  snapshot() {
    const sounds = this.soundQueue
    this.soundQueue = []
    return {
      sprites: this.sprites.map(s => ({
        id: s.id,
        name: s.name,
        x: s.x,
        y: s.y,
        direction: s.direction,
        size: s.size,
        visible: s.visible,
        rotationStyle: s.rotationStyle,
        costume: s.costumes[s.currentCostume]?.name ?? null,
        effects: { ...s.effects },
        bubble: s.sayBubble,
        isClone: s.isClone,
      })),
      backdrop: this.stage.backdrops[this.stage.currentBackdrop]?.name ?? null,
      watches: this.watches.map(w => ({ name: w.name, value: display(w.get()) })),
      sounds,
    }
  }
}
