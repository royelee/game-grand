import { describe, it, expect } from 'vitest'
import { batchOps } from './penBatch'
import type { PenOp } from '../runtime/pen'

const line = (x1: number, y1: number, x2: number, y2: number): PenOp => ({
  kind: 'line', x1, y1, x2, y2, color: 0xff0000, alpha: 1, size: 2,
})

describe('batchOps', () => {
  it('converts stage coordinates to Phaser ones', () => {
    const [draw] = batchOps([line(0, 0, 10, 20)])
    expect(draw).toEqual({
      kind: 'strokes',
      strokes: [{ kind: 'line', x1: 240, y1: 180, x2: 250, y2: 160, color: 0xff0000, alpha: 1, size: 2 }],
    })
  })

  it('merges consecutive strokes into one batch', () => {
    const draws = batchOps([line(0, 0, 1, 1), line(1, 1, 2, 2), line(2, 2, 3, 3)])
    expect(draws).toHaveLength(1)
    expect(draws[0]).toMatchObject({ kind: 'strokes' })
    expect((draws[0] as { strokes: unknown[] }).strokes).toHaveLength(3)
  })

  it('treats clear and stamp as barriers that keep their order', () => {
    const draws = batchOps([
      line(0, 0, 1, 1),
      { kind: 'clear' },
      line(2, 2, 3, 3),
      { kind: 'stamp', spriteId: 4 },
      line(4, 4, 5, 5),
    ])
    expect(draws.map(d => d.kind)).toEqual(['strokes', 'clear', 'strokes', 'stamp', 'strokes'])
  })

  it('carries dots through with converted coordinates', () => {
    const draws = batchOps([{ kind: 'dot', x: -240, y: 180, color: 1, alpha: 0.5, size: 8 }])
    expect(draws).toEqual([
      { kind: 'strokes', strokes: [{ kind: 'dot', x: 0, y: 0, color: 1, alpha: 0.5, size: 8 }] },
    ])
  })

  it('returns nothing for an empty frame', () => {
    expect(batchOps([])).toEqual([])
  })
})
