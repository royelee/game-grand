import { describe, it, expect } from 'vitest'
import { toPhaserX, toPhaserY, toStageX, toStageY, viewFor, reconcile } from './spriteViews'

const snapSprite = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over })
function base() {
  return {
    id: 1, name: 'Cat', x: 0, y: 0, direction: 90, size: 100, visible: true,
    rotationStyle: 'all around' as 'all around' | 'left-right' | "don't rotate", costume: 'cat-a',
    effects: {} as Record<string, number>,
    bubble: null as { text: string; kind: 'say' | 'think' } | null,
    isClone: false,
  }
}

describe('coordinate mapping', () => {
  it('maps stage centre to canvas centre and flips y', () => {
    expect(toPhaserX(0)).toBe(240)
    expect(toPhaserY(0)).toBe(180)
    expect(toPhaserY(180)).toBe(0)
    expect(toPhaserX(-240)).toBe(0)
  })

  it('round-trips back to stage coordinates', () => {
    expect(toStageX(toPhaserX(37))).toBeCloseTo(37)
    expect(toStageY(toPhaserY(-42))).toBeCloseTo(-42)
  })
})

describe('viewFor', () => {
  it('converts position, angle, and scale', () => {
    const v = viewFor(snapSprite({ x: 10, y: 20, direction: 180, size: 50 }), 0)
    expect(v).toMatchObject({ id: 1, px: 250, py: 160, angle: 90, scale: 0.5, depth: 0 })
  })

  it('maps ghost effect to alpha and hides invisible sprites', () => {
    expect(viewFor(snapSprite({ effects: { ghost: 25 } }), 0).alpha).toBeCloseTo(0.75)
    expect(viewFor(snapSprite({ effects: { ghost: 300 } }), 0).alpha).toBe(0)
    expect(viewFor(snapSprite({ visible: false }), 0).alpha).toBe(0)
  })

  it('honours rotation styles', () => {
    const lr = viewFor(snapSprite({ direction: -90, rotationStyle: 'left-right' }), 0)
    expect(lr).toMatchObject({ angle: 0, flipX: true })
    const lrRight = viewFor(snapSprite({ direction: 90, rotationStyle: 'left-right' }), 0)
    expect(lrRight).toMatchObject({ angle: 0, flipX: false })
    const none = viewFor(snapSprite({ direction: 45, rotationStyle: "don't rotate" }), 0)
    expect(none.angle).toBe(0)
  })

  it('carries the bubble and texture key', () => {
    const v = viewFor(snapSprite({ bubble: { text: 'Hi', kind: 'say' }, costume: 'cat-b' }), 3)
    expect(v.bubble).toEqual({ text: 'Hi', kind: 'say' })
    expect(v.texture).toBe('cat-b')
    expect(v.depth).toBe(3)
  })
})

describe('reconcile', () => {
  const snap = (ids: number[]) => ({
    sprites: ids.map(id => snapSprite({ id })),
  })

  it('creates views for new ids and destroys vanished ones', () => {
    const first = reconcile(new Set(), snap([1, 2]))
    expect(first.create).toEqual([1, 2])
    expect(first.destroy).toEqual([])
    const second = reconcile(new Set([1, 2]), snap([2, 3]))
    expect(second.create).toEqual([3])
    expect(second.destroy).toEqual([1])
  })

  it('reports depth from array order, back to front', () => {
    const r = reconcile(new Set([1, 2]), snap([2, 1]))
    expect(r.order).toEqual([2, 1])
    expect(r.update.map(v => [v.id, v.depth])).toEqual([[2, 0], [1, 1]])
  })
})
