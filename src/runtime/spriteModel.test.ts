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

  it('setRotationStyle accepts valid styles', () => {
    const { s } = make()
    s.setRotationStyle('left-right')
    expect(s.rotationStyle).toBe('left-right')
    s.setRotationStyle("don't rotate")
    expect(s.rotationStyle).toBe("don't rotate")
    s.setRotationStyle('all around')
    expect(s.rotationStyle).toBe('all around')
  })

  it('setRotationStyle throws FriendlyError for invalid style', () => {
    const { s } = make()
    expect(() => s.setRotationStyle('spin')).toThrow(FriendlyError)
    const error = new FriendlyError('')
    try {
      s.setRotationStyle('spin')
    } catch (e) {
      if (e instanceof FriendlyError) {
        expect(e.message).toContain('all around')
        expect(e.message).toContain('left-right')
        expect(e.message).toContain("don't rotate")
      }
    }
  })

  it('validates all motion setters with FriendlyError', () => {
    const { s } = make()
    expect(() => s.turnRight('x' as unknown as number)).toThrow(FriendlyError)
    expect(() => s.turnLeft('x' as unknown as number)).toThrow(FriendlyError)
    expect(() => s.goTo('a' as unknown as number, 0)).toThrow(FriendlyError)
    expect(() => s.goTo(0, 'a' as unknown as number)).toThrow(FriendlyError)
    expect(() => s.changeX('a' as unknown as number)).toThrow(FriendlyError)
    expect(() => s.changeY('a' as unknown as number)).toThrow(FriendlyError)
    expect(() => s.glide('a' as unknown as number, 0, 1)).toThrow(FriendlyError)
    expect(() => s.glide(0, 'a' as unknown as number, 1)).toThrow(FriendlyError)
    expect(() => s.glide(0, 0, 'a' as unknown as number)).toThrow(FriendlyError)
  })

  it('changeX and changeY work on the happy path', () => {
    const { s } = make()
    s.changeX(10)
    expect(s.x).toBe(10)
    s.changeY(20)
    expect(s.y).toBe(20)
    s.changeX(-5)
    expect(s.x).toBe(5)
    s.changeY(-10)
    expect(s.y).toBe(10)
  })
})
