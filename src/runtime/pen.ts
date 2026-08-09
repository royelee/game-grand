import { hsbToRgb, rgbToHsb, rgbToInt, type Rgb } from './colors'
import { FriendlyError, expectNumber, show } from './errors'

export type PenOp =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: number; alpha: number; size: number }
  | { kind: 'dot'; x: number; y: number; color: number; alpha: number; size: number }
  | { kind: 'stamp'; spriteId: number }
  | { kind: 'clear' }

/**
 * A synchronous loop can emit unboundedly many ops into one frame. The frame
 * is already lost to the loop itself, so the overflow is dropped silently
 * rather than reported — "too many pen lines" is noise to a kid who has not
 * yet worked out why their game froze.
 */
export const MAX_OPS_PER_FRAME = 10000

export const PEN_PARAMS = ['color', 'saturation', 'brightness', 'transparency'] as const
export type PenParam = (typeof PEN_PARAMS)[number]

const wrap100 = (n: number): number => ((n % 100) + 100) % 100
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export class PenLayer {
  private ops: PenOp[] = []

  push(op: PenOp): void {
    if (this.ops.length >= MAX_OPS_PER_FRAME) return
    this.ops.push(op)
  }

  /**
   * Everything queued earlier this frame is about to be erased anyway, so
   * dropping it is exactly equivalent to drawing it and then clearing — and it
   * means a clear can never be lost to the per-frame cap.
   */
  clear(): void {
    this.ops = [{ kind: 'clear' }]
  }

  drain(): PenOp[] {
    const out = this.ops
    this.ops = []
    return out
  }
}

export class PenState {
  down = false
  size = 1
  color = 66.66
  saturation = 100
  brightness = 100
  transparency = 0
  /** Cached 0xRRGGBB, so emitting a segment never costs a color conversion. */
  rgb = 0

  constructor() {
    this.recompute()
  }

  get alpha(): number {
    return 1 - this.transparency / 100
  }

  private recompute(): void {
    this.rgb = rgbToInt(
      hsbToRgb({ hue: this.color, saturation: this.saturation, brightness: this.brightness }),
    )
  }

  private normalize(): void {
    this.color = wrap100(this.color)
    this.saturation = clamp(this.saturation, 0, 100)
    this.brightness = clamp(this.brightness, 0, 100)
    this.transparency = clamp(this.transparency, 0, 100)
    this.recompute()
  }

  setParams(patch: Partial<Record<PenParam, number>>): void {
    for (const p of PEN_PARAMS) {
      const next = patch[p]
      if (next !== undefined) this[p] = next
    }
    this.normalize()
  }

  changeParams(patch: Partial<Record<PenParam, number>>): void {
    for (const p of PEN_PARAMS) {
      const delta = patch[p]
      if (delta !== undefined) this[p] += delta
    }
    this.normalize()
  }

  setColorFromRgb(rgb: Rgb, alpha: number): void {
    const hsb = rgbToHsb(rgb)
    this.color = hsb.hue
    this.saturation = hsb.saturation
    this.brightness = hsb.brightness
    this.transparency = 100 * (1 - alpha)
    this.normalize()
  }

  setSize(n: number): void {
    this.size = clamp(n, 1, 1200)
  }

  changeSize(n: number): void {
    this.setSize(this.size + n)
  }

  copyFrom(other: PenState): void {
    this.down = other.down
    this.size = other.size
    this.color = other.color
    this.saturation = other.saturation
    this.brightness = other.brightness
    this.transparency = other.transparency
    this.rgb = other.rgb
  }
}

const SIZE_HINT: Record<string, string> = {
  setPen: 'sprite.setPenSize(5)',
  changePen: 'sprite.changePenSize(2)',
}

export function readPenSettings(
  fn: string,
  value: unknown,
): Partial<Record<PenParam, number>> {
  const example = `sprite.${fn}({ color: 50 })`
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FriendlyError(
      `\`${fn}\` needs a list of pen settings, like \`${example}\` — you gave it ${show(value)}.`,
    )
  }

  const patch: Partial<Record<PenParam, number>> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'size') {
      throw new FriendlyError(
        `\`${fn}\` changes the pen's colors — to change how thick it is, use \`${SIZE_HINT[fn]}\`.`,
      )
    }
    if (!PEN_PARAMS.includes(key as PenParam)) {
      const known = PEN_PARAMS.map(p => `"${p}"`)
      throw new FriendlyError(
        `\`${fn}\` doesn't know the pen setting "${key}". You can set ${known.slice(0, -1).join(', ')} and ${known[known.length - 1]}.`,
      )
    }
    patch[key as PenParam] = expectNumber(fn, example, raw)
  }

  if (Object.keys(patch).length === 0) {
    throw new FriendlyError(`\`${fn}\` needs at least one pen setting, like \`${example}\`.`)
  }
  return patch
}
