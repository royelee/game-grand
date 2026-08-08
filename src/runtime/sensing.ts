import { SpriteModel, STAGE_WIDTH, STAGE_HEIGHT } from './spriteModel'

export function bounds(s: SpriteModel): { left: number; right: number; top: number; bottom: number } {
  const { halfW, halfH } = s.halfExtents()
  return { left: s.x - halfW, right: s.x + halfW, top: s.y + halfH, bottom: s.y - halfH }
}

export function touchingSprites(a: SpriteModel, b: SpriteModel): boolean {
  if (!a.visible || !b.visible || a.deleted || b.deleted) return false
  const A = bounds(a)
  const B = bounds(b)
  return A.left < B.right && B.left < A.right && A.bottom < B.top && B.bottom < A.top
}

export function touchingEdge(a: SpriteModel): boolean {
  const A = bounds(a)
  return (
    A.left <= -STAGE_WIDTH / 2 ||
    A.right >= STAGE_WIDTH / 2 ||
    A.bottom <= -STAGE_HEIGHT / 2 ||
    A.top >= STAGE_HEIGHT / 2
  )
}

export function distanceBetween(a: SpriteModel, p: { x: number; y: number }): number {
  return Math.hypot(p.x - a.x, p.y - a.y)
}
