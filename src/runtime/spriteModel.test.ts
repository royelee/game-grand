import { describe, it, expect } from 'vitest'
import { Clock } from './clock'
import { SpriteModel, type Costume } from './spriteModel'
import { FriendlyError } from './errors'
import { PenLayer } from './pen'

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

describe('pen', () => {
  const makePen = () => {
    const layer = new PenLayer()
    const clock = new Clock()
    return { layer, clock, s: new SpriteModel('Cat', cat, clock, 7, layer) }
  }

  it('penDown marks a dot where the sprite already is', () => {
    const { layer, s } = makePen()
    s.goTo(10, 20)
    s.penDown()
    expect(layer.drain()).toEqual([
      { kind: 'dot', x: 10, y: 20, color: 0x0000ff, alpha: 1, size: 1 },
    ])
  })

  it('draws nothing while the pen is up', () => {
    const { layer, s } = makePen()
    s.move(10)
    s.goTo(1, 2)
    s.changeX(3)
    s.changeY(4)
    expect(layer.drain()).toEqual([])
  })

  it('every motion path draws a segment from where the sprite was', () => {
    const { layer, s } = makePen()
    s.penDown()
    layer.drain()

    s.goTo(0, 0)
    s.changeX(10)
    s.changeY(5)
    const ops = layer.drain()
    expect(ops).toHaveLength(2)
    expect(ops[0]).toMatchObject({ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 })
    expect(ops[1]).toMatchObject({ kind: 'line', x1: 10, y1: 0, x2: 10, y2: 5 })
  })

  it('move draws along the direction it faces', () => {
    const { layer, s } = makePen()
    s.goTo(0, 0)
    s.penDown()
    layer.drain()
    s.move(10)
    const [op] = layer.drain()
    expect(op).toMatchObject({ kind: 'line', x1: 0, y1: 0, x2: 10 })
  })

  it('glide draws one segment per frame, not one for the whole glide', () => {
    const { layer, clock, s } = makePen()
    s.goTo(0, 0)
    s.penDown()
    layer.drain()
    void s.glide(10, 0, 1)
    clock.tick(0.5)
    clock.tick(0.5)
    const ops = layer.drain()
    expect(ops).toHaveLength(2)
    expect(ops[0]).toMatchObject({ x1: 0, x2: 5 })
    expect(ops[1]).toMatchObject({ x1: 5, x2: 10 })
  })

  it('ifOnEdgeBounce draws the nudge back inside', () => {
    const { layer, s } = makePen()
    s.goTo(400, 0)
    s.penDown()
    layer.drain()
    s.ifOnEdgeBounce()
    const ops = layer.drain()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'line', x1: 400, x2: 230 })
  })

  it('penUp stops the drawing without moving anything', () => {
    const { layer, s } = makePen()
    s.penDown()
    layer.drain()
    s.penUp()
    s.move(10)
    expect(layer.drain()).toEqual([])
  })

  it('uses the pen colour and size that were set', () => {
    const { layer, s } = makePen()
    s.setPenColor('hotpink')
    s.setPenSize(8)
    s.goTo(0, 0)
    s.penDown()
    expect(layer.drain()).toEqual([
      { kind: 'dot', x: 0, y: 0, color: 0xff69b4, alpha: 1, size: 8 },
    ])
  })

  it('rejects a colour it does not know, by name', () => {
    const { s } = makePen()
    expect(() => s.setPenColor('blurple')).toThrow(
      '`setPenColor` doesn\'t know the color "blurple". Try a color name like "red", "hotpink" or "skyblue", or a hex code like "#ff0000".',
    )
    expect(() => s.setPenColor(5)).toThrow('`setPenColor` needs some text in quotes')
  })

  it('a hidden sprite stamps nothing', () => {
    const { layer, s } = makePen()
    s.hide()
    s.stamp()
    expect(layer.drain()).toEqual([])
  })

  it('stamp freezes the pose, so moving on afterwards does not drag it', () => {
    const { layer, s } = makePen()
    s.goTo(-170, 90)
    s.pointInDirection(45)
    s.setSize(150)
    s.stamp()
    s.goTo(0, 0)
    const [op] = layer.drain()
    expect(op).toEqual({
      kind: 'stamp',
      pose: {
        id: 7,
        name: 'Cat',
        x: -170,
        y: 90,
        direction: 45,
        size: 150,
        visible: true,
        rotationStyle: 'all around',
        costume: 'cat-a',
        effects: {},
        bubble: null,
      },
    })
  })

  it('setPen and changePen reach the pen state', () => {
    const { s } = makePen()
    s.setPen({ color: 0 })
    expect(s.pen.rgb).toBe(0xff0000)
    s.changePen({ transparency: 50 })
    expect(s.pen.alpha).toBeCloseTo(0.5, 5)
    expect(() => s.setPen({ nope: 1 })).toThrow('`setPen` doesn\'t know the pen setting "nope"')
  })
})
