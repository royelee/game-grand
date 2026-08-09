import { Clock } from './clock'
import { FriendlyError, expectNumber, expectString } from './errors'
import { PenLayer, PenState, readPenSettings } from './pen'
import { parseColor } from './colors'

export interface Costume {
  name: string
  width: number
  height: number
  source: string
}

export type RotationStyle = 'all around' | 'left-right' | "don't rotate"

/**
 * Everything a renderer needs to draw one sprite. A snapshot sprite satisfies
 * it, and so does the pose a `stamp` freezes — which is why it is a named
 * shape rather than "whatever snapshot() happens to return".
 */
export interface RenderablePose {
  id: number
  name: string
  x: number
  y: number
  direction: number
  size: number
  visible: boolean
  rotationStyle: RotationStyle
  costume: string | null
  effects: Record<string, number>
  bubble: { text: string; kind: 'say' | 'think' } | null
}

export const STAGE_WIDTH = 480
export const STAGE_HEIGHT = 360

export function wrapDirection(d: number): number {
  const n = ((d % 360) + 360) % 360
  return n > 180 ? n - 360 : n
}

export class SpriteModel {
  private _x = 0
  private _y = 0
  direction = 90
  size = 100
  visible = true
  rotationStyle: RotationStyle = 'all around'
  effects: Record<string, number> = {}
  sayBubble: { text: string; kind: 'say' | 'think' } | null = null
  currentCostume = 0
  deleted = false
  isClone = false
  pen = new PenState()
  private bubbleGen = 0

  constructor(
    public name: string,
    public costumes: Costume[],
    private clock: Clock,
    // Assigned by World (monotonic counter) so renderers can reconcile a
    // sprite across snapshots even as clones share names and layer order
    // mutates. Defaults to 0 for direct construction in tests.
    public readonly id: number = 0,
    private penLayer: PenLayer = new PenLayer(),
  ) {}

  get x(): number {
    return this._x
  }

  get y(): number {
    return this._y
  }

  /**
   * The only writer of x/y. The fields are private precisely so that no motion
   * path can move a sprite without the pen noticing: a hook remembered at each
   * call site would fail silently the first time someone adds another one.
   */
  place(x: number, y: number): void {
    // A move that goes nowhere draws nothing: otherwise a goTo of the current
    // position inside onUpdate would spend a pen op every frame forever.
    if (this.pen.down && (x !== this._x || y !== this._y)) {
      this.penLayer.push({
        kind: 'line',
        x1: this._x,
        y1: this._y,
        x2: x,
        y2: y,
        color: this.pen.rgb,
        alpha: this.pen.alpha,
        size: this.pen.size,
      })
    }
    this._x = x
    this._y = y
  }

  halfExtents(): { halfW: number; halfH: number } {
    const c = this.costumes[this.currentCostume]
    return {
      halfW: ((c?.width ?? 0) * this.size) / 200,
      halfH: ((c?.height ?? 0) * this.size) / 200,
    }
  }

  move(steps: unknown): void {
    const n = expectNumber('move', 'sprite.move(10)', steps)
    const rad = (this.direction * Math.PI) / 180
    this.place(this._x + n * Math.sin(rad), this._y + n * Math.cos(rad))
  }

  turnRight(deg: unknown): void {
    const n = expectNumber('turnRight', 'sprite.turnRight(15)', deg)
    this.direction = wrapDirection(this.direction + n)
  }

  turnLeft(deg: unknown): void {
    const n = expectNumber('turnLeft', 'sprite.turnLeft(15)', deg)
    this.direction = wrapDirection(this.direction - n)
  }

  goTo(x: unknown, y: unknown): void {
    // Both arguments validate before either lands, so a bad y cannot leave x
    // half-applied.
    this.place(
      expectNumber('goTo', 'sprite.goTo(0, 0)', x),
      expectNumber('goTo', 'sprite.goTo(0, 0)', y),
    )
  }

  changeX(n: unknown): void {
    this.place(this._x + expectNumber('changeX', 'sprite.changeX(10)', n), this._y)
  }

  changeY(n: unknown): void {
    this.place(this._x, this._y + expectNumber('changeY', 'sprite.changeY(10)', n))
  }

  pointInDirection(deg: unknown): void {
    const n = expectNumber('pointInDirection', 'sprite.pointInDirection(90)', deg)
    this.direction = wrapDirection(n)
  }

  pointTowards(target: { x: number; y: number }): void {
    const deg = (Math.atan2(target.x - this.x, target.y - this.y) * 180) / Math.PI
    this.direction = wrapDirection(deg)
  }

  setRotationStyle(style: unknown): void {
    const valid: RotationStyle[] = ['all around', 'left-right', "don't rotate"]
    if (!valid.includes(style as RotationStyle)) {
      throw new FriendlyError(
        `\`setRotationStyle\` needs one of ${valid.map(v => `"${v}"`).join(', ')} — you gave it ${JSON.stringify(style)}.`,
      )
    }
    this.rotationStyle = style as RotationStyle
  }

  glide(x: unknown, y: unknown, secs: unknown): Promise<void> {
    const tx = expectNumber('glide', 'sprite.glide(100, 100, 1)', x)
    const ty = expectNumber('glide', 'sprite.glide(100, 100, 1)', y)
    const s = expectNumber('glide', 'sprite.glide(100, 100, 1)', secs)
    if (s <= 0) {
      this.place(tx, ty)
      return Promise.resolve()
    }
    const sx = this._x
    const sy = this._y
    const start = this.clock.now
    return new Promise(resolve => {
      const unsub = this.clock.onFrame(() => {
        const t = Math.min(1, (this.clock.now - start) / s)
        this.place(sx + (tx - sx) * t, sy + (ty - sy) * t)
        if (t >= 1) {
          unsub()
          resolve()
        }
      })
    })
  }

  ifOnEdgeBounce(): void {
    const { halfW, halfH } = this.halfExtents()
    const R = STAGE_WIDTH / 2
    const T = STAGE_HEIGHT / 2
    if (this.x + halfW > R || this.x - halfW < -R) {
      this.direction = wrapDirection(-this.direction)
    }
    if (this.y + halfH > T || this.y - halfH < -T) {
      this.direction = wrapDirection(180 - this.direction)
    }
    this.place(
      Math.min(Math.max(this._x, -R + halfW), R - halfW),
      Math.min(Math.max(this._y, -T + halfH), T - halfH),
    )
  }

  private bubble(kind: 'say' | 'think', text: unknown, secs?: unknown): Promise<void> | void {
    // Validate before mutating: an invalid `secs` must not leave a permanent bubble behind.
    const s = secs === undefined ? undefined : expectNumber(kind, `sprite.${kind}("Hi", 2)`, secs)
    const t = String(text ?? '')
    const gen = ++this.bubbleGen
    this.sayBubble = t === '' ? null : { text: t, kind }
    if (s === undefined) return
    return this.clock.wait(s).then(() => {
      if (this.bubbleGen === gen) this.sayBubble = null
    })
  }

  say(text: unknown, secs?: unknown): Promise<void> | void {
    return this.bubble('say', text, secs)
  }

  think(text: unknown, secs?: unknown): Promise<void> | void {
    return this.bubble('think', text, secs)
  }

  switchCostume(name: unknown): void {
    const n = expectString('switchCostume', 'sprite.switchCostume("cat-a")', name)
    const idx = this.costumes.findIndex(c => c.name === n)
    if (idx === -1) {
      const names = this.costumes.map(c => `"${c.name}"`).join(', ')
      throw new FriendlyError(
        `\`switchCostume\` couldn't find a costume called "${n}". This sprite's costumes are: ${names}.`,
      )
    }
    this.currentCostume = idx
  }

  nextCostume(): void {
    this.currentCostume = (this.currentCostume + 1) % this.costumes.length
  }

  setSize(percent: unknown): void {
    const n = expectNumber('setSize', 'sprite.setSize(150)', percent)
    this.size = Math.min(500, Math.max(5, n))
  }

  show(): void {
    this.visible = true
  }

  hide(): void {
    this.visible = false
  }

  setEffect(name: unknown, value: unknown): void {
    const known = ['ghost', 'brightness', 'color']
    if (typeof name !== 'string' || !known.includes(name)) {
      throw new FriendlyError(
        `\`setEffect\` knows these effects: ${known.map(k => `"${k}"`).join(', ')} — you gave it ${JSON.stringify(name)}.`,
      )
    }
    this.effects[name] = expectNumber('setEffect', 'sprite.setEffect("ghost", 50)', value)
  }

  clearEffects(): void {
    this.effects = {}
  }

  penDown(): void {
    this.pen.down = true
    // Scratch marks a dot straight away, so a sprite that puts its pen down and
    // never moves still leaves something behind.
    this.penLayer.push({
      kind: 'dot',
      x: this._x,
      y: this._y,
      color: this.pen.rgb,
      alpha: this.pen.alpha,
      size: this.pen.size,
    })
  }

  penUp(): void {
    this.pen.down = false
  }

  /**
   * The pose is frozen into the op rather than looked up at render time: a
   * script that stamps and then moves on in the same frame must leave the
   * stamp where the sprite was, not where it ended up.
   */
  stamp(): void {
    if (!this.visible) return
    this.penLayer.push({ kind: 'stamp', pose: this.pose() })
  }

  pose(): RenderablePose {
    return {
      id: this.id,
      name: this.name,
      x: this._x,
      y: this._y,
      direction: this.direction,
      size: this.size,
      visible: this.visible,
      rotationStyle: this.rotationStyle,
      costume: this.costumes[this.currentCostume]?.name ?? null,
      effects: { ...this.effects },
      // Scratch does not stamp speech bubbles.
      bubble: null,
    }
  }

  setPenColor(color: unknown): void {
    const text = expectString('setPenColor', 'sprite.setPenColor("red")', color)
    const parsed = parseColor(text)
    if (!parsed) {
      throw new FriendlyError(
        `\`setPenColor\` doesn't know the color "${text}". Try a color name like "red", "hotpink" or "skyblue", or a hex code like "#ff0000".`,
      )
    }
    this.pen.setColorFromRgb(parsed.rgb, parsed.alpha)
  }

  setPenSize(n: unknown): void {
    this.pen.setSize(expectNumber('setPenSize', 'sprite.setPenSize(5)', n))
  }

  changePenSize(n: unknown): void {
    this.pen.changeSize(expectNumber('changePenSize', 'sprite.changePenSize(2)', n))
  }

  setPen(settings: unknown): void {
    this.pen.setParams(readPenSettings('setPen', settings))
  }

  changePen(settings: unknown): void {
    this.pen.changeParams(readPenSettings('changePen', settings))
  }
}
