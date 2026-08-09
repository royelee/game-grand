import type { PenOp } from '../runtime/pen'
import { toPhaserX, toPhaserY } from './spriteViews'

export type PenStroke =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: number; alpha: number; size: number }
  | { kind: 'dot'; x: number; y: number; color: number; alpha: number; size: number }

export type PenDraw =
  | { kind: 'strokes'; strokes: PenStroke[] }
  | { kind: 'clear' }
  | { kind: 'stamp'; spriteId: number }

/**
 * Groups a frame's ops so the renderer can put every consecutive line and dot
 * into a single Graphics pass. Clears and stamps are barriers: they have to
 * land between the strokes on either side of them, or an eraseAll mid-frame
 * would wipe the drawing that came after it.
 */
export function batchOps(ops: PenOp[]): PenDraw[] {
  const draws: PenDraw[] = []
  let strokes: PenStroke[] = []

  const flush = (): void => {
    if (strokes.length > 0) {
      draws.push({ kind: 'strokes', strokes })
      strokes = []
    }
  }

  for (const op of ops) {
    if (op.kind === 'clear' || op.kind === 'stamp') {
      flush()
      draws.push(op)
      continue
    }
    if (op.kind === 'dot') {
      strokes.push({
        kind: 'dot',
        x: toPhaserX(op.x),
        y: toPhaserY(op.y),
        color: op.color,
        alpha: op.alpha,
        size: op.size,
      })
      continue
    }
    strokes.push({
      kind: 'line',
      x1: toPhaserX(op.x1),
      y1: toPhaserY(op.y1),
      x2: toPhaserX(op.x2),
      y2: toPhaserY(op.y2),
      color: op.color,
      alpha: op.alpha,
      size: op.size,
    })
  }

  flush()
  return draws
}
