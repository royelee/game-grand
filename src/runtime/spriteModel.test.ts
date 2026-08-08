import { describe, it, expect } from 'vitest'
import { Clock } from './clock'
import { SpriteModel, type Costume } from './spriteModel'
import { FriendlyError } from './errors'

const cat: Costume[] = [{ name: 'cat-a', width: 20, height: 20, source: 'library:cat-a' }]
const make = () => {
  const clock = new Clock()
  return { clock, s: new SpriteModel('Cat', cat, clock) }
}

describe('SpriteModel motion', () => {
  it('moves along its direction (90 = right, 0 = up)', () => {
    const { s } = make()
    s.move(10)
    expect(s.x).toBeCloseTo(10)
    expect(s.y).toBeCloseTo(0)
    s.pointInDirection(0)
    s.move(10)
    expect(s.y).toBeCloseTo(10)
  })

  it('validates arguments with FriendlyError', () => {
    const { s } = make()
    expect(() => s.move('fast' as unknown as number)).toThrow(FriendlyError)
  })

  it('wraps direction to (-180, 180]', () => {
    const { s } = make()
    s.turnRight(270) // 90 + 270 = 360 -> 0
    expect(s.direction).toBe(0)
    s.turnLeft(270) // 0 - 270 = -270 -> 90
    expect(s.direction).toBe(90)
  })

  it('points towards a target', () => {
    const { s } = make()
    s.goTo(0, 0)
    s.pointTowards({ x: 10, y: 0 })
    expect(s.direction).toBeCloseTo(90)
    s.pointTowards({ x: 0, y: 10 })
    expect(s.direction).toBeCloseTo(0)
  })

  it('glides linearly over time', async () => {
    const { clock, s } = make()
    const done = s.glide(100, 0, 2)
    clock.tick(1)
    expect(s.x).toBeCloseTo(50)
    clock.tick(1)
    await done
    expect(s.x).toBeCloseTo(100)
  })

  it('glide with zero seconds jumps immediately', async () => {
    const { s } = make()
    await s.glide(30, 40, 0)
    expect(s.x).toBe(30)
    expect(s.y).toBe(40)
  })

  it('bounces off the right edge: flips direction and clamps inside', () => {
    const { s } = make() // costume 20 wide -> halfW 10
    s.goTo(235, 0)
    s.pointInDirection(90)
    s.ifOnEdgeBounce()
    expect(s.direction).toBe(-90)
    expect(s.x).toBe(230)
  })
})
