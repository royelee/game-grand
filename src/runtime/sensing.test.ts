import { describe, it, expect } from 'vitest'
import { Clock } from './clock'
import { SpriteModel, type Costume } from './spriteModel'
import { touchingSprites, touchingEdge, distanceBetween } from './sensing'

const c20: Costume[] = [{ name: 'a', width: 20, height: 20, source: 'library:a' }]
const at = (x: number, y: number) => {
  const s = new SpriteModel('S', c20, new Clock())
  s.goTo(x, y)
  return s
}

describe('sensing', () => {
  it('detects AABB overlap scaled by size', () => {
    const a = at(0, 0)
    const b = at(15, 0) // half-widths 10+10, distance 15 -> overlap
    expect(touchingSprites(a, b)).toBe(true)
    b.goTo(25, 0)
    expect(touchingSprites(a, b)).toBe(false)
    b.setSize(200) // halfW now 20; 10 + 20 > 25
    expect(touchingSprites(a, b)).toBe(true)
  })

  it('hidden or deleted sprites never touch', () => {
    const a = at(0, 0)
    const b = at(0, 0)
    b.hide()
    expect(touchingSprites(a, b)).toBe(false)
    b.show()
    b.deleted = true
    expect(touchingSprites(a, b)).toBe(false)
  })

  it('detects the stage edge', () => {
    expect(touchingEdge(at(0, 0))).toBe(false)
    expect(touchingEdge(at(235, 0))).toBe(true)
    expect(touchingEdge(at(0, -175))).toBe(true)
  })

  it('measures distance between centers', () => {
    expect(distanceBetween(at(0, 0), { x: 3, y: 4 })).toBeCloseTo(5)
  })
})
