import { Clock } from './clock'
import { FriendlyError, expectNumber } from './errors'

export interface Costume {
  name: string
  width: number
  height: number
  source: string
}

export type RotationStyle = 'all around' | 'left-right' | "don't rotate"

export const STAGE_WIDTH = 480
export const STAGE_HEIGHT = 360

export function wrapDirection(d: number): number {
  const n = ((d % 360) + 360) % 360
  return n > 180 ? n - 360 : n
}

export class SpriteModel {
  x = 0
  y = 0
  direction = 90
  size = 100
  visible = true
  rotationStyle: RotationStyle = 'all around'
  effects: Record<string, number> = {}
  sayBubble: { text: string; kind: 'say' | 'think' } | null = null
  currentCostume = 0
  deleted = false
  isClone = false

  constructor(
    public name: string,
    public costumes: Costume[],
    private clock: Clock,
  ) {}

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
    this.x += n * Math.sin(rad)
    this.y += n * Math.cos(rad)
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
    this.x = expectNumber('goTo', 'sprite.goTo(0, 0)', x)
    this.y = expectNumber('goTo', 'sprite.goTo(0, 0)', y)
  }

  changeX(n: unknown): void {
    this.x += expectNumber('changeX', 'sprite.changeX(10)', n)
  }

  changeY(n: unknown): void {
    this.y += expectNumber('changeY', 'sprite.changeY(10)', n)
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
      this.x = tx
      this.y = ty
      return Promise.resolve()
    }
    const sx = this.x
    const sy = this.y
    const start = this.clock.now
    return new Promise(resolve => {
      const unsub = this.clock.onFrame(() => {
        const t = Math.min(1, (this.clock.now - start) / s)
        this.x = sx + (tx - sx) * t
        this.y = sy + (ty - sy) * t
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
    this.x = Math.min(Math.max(this.x, -R + halfW), R - halfW)
    this.y = Math.min(Math.max(this.y, -T + halfH), T - halfH)
  }
}
