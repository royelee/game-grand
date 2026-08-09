import { describe, it, expect } from 'vitest'
import { PenLayer, PenState, readPenSettings, MAX_OPS_PER_FRAME } from './pen'
import { FriendlyError } from './errors'

describe('PenState defaults', () => {
  it('starts pen-up, thin, and Scratch blue', () => {
    const p = new PenState()
    expect(p.down).toBe(false)
    expect(p.size).toBe(1)
    expect(p.color).toBeCloseTo(66.66, 2)
    expect(p.saturation).toBe(100)
    expect(p.brightness).toBe(100)
    expect(p.transparency).toBe(0)
    expect(p.rgb).toBe(0x0000ff)
    expect(p.alpha).toBe(1)
  })
})

describe('PenState parameters', () => {
  it('wraps hue but clamps the other three', () => {
    const p = new PenState()
    p.setParams({ color: 105 })
    expect(p.color).toBeCloseTo(5, 5)
    p.setParams({ color: -10 })
    expect(p.color).toBeCloseTo(90, 5)
    p.setParams({ saturation: 150, brightness: -20, transparency: 400 })
    expect(p.saturation).toBe(100)
    expect(p.brightness).toBe(0)
    expect(p.transparency).toBe(100)
  })

  it('changeParams adds and then normalizes', () => {
    const p = new PenState()
    p.setParams({ color: 95 })
    p.changeParams({ color: 10 })
    expect(p.color).toBeCloseTo(5, 5)
    p.changeParams({ saturation: -500 })
    expect(p.saturation).toBe(0)
  })

  it('recomputes the cached rgb and alpha whenever a parameter moves', () => {
    const p = new PenState()
    p.setParams({ color: 0 })
    expect(p.rgb).toBe(0xff0000)
    p.setParams({ transparency: 25 })
    expect(p.alpha).toBeCloseTo(0.75, 5)
  })

  it('setColorFromRgb writes all three color channels and resets transparency', () => {
    const p = new PenState()
    p.setParams({ transparency: 60 })
    p.setColorFromRgb({ r: 255, g: 105, b: 180 }, 1)
    expect(p.rgb).toBe(0xff69b4)
    expect(p.transparency).toBe(0)
    // Continuing to shift hue must start from hot pink, not from wherever the
    // hue happened to be.
    const before = p.color
    p.changeParams({ color: 5 })
    expect(p.color).toBeCloseTo(before + 5, 5)
  })

  it('takes transparency from a color that carries alpha', () => {
    const p = new PenState()
    p.setColorFromRgb({ r: 255, g: 0, b: 0 }, 0.5)
    expect(p.transparency).toBeCloseTo(50, 5)
  })

  it('clamps size to 1-1200', () => {
    const p = new PenState()
    p.setSize(0)
    expect(p.size).toBe(1)
    p.setSize(99999)
    expect(p.size).toBe(1200)
    p.setSize(10)
    p.changeSize(5)
    expect(p.size).toBe(15)
    p.changeSize(-1000)
    expect(p.size).toBe(1)
  })

  it('copyFrom clones every field, so clones inherit the pen', () => {
    const src = new PenState()
    src.down = true
    src.setSize(9)
    src.setParams({ color: 20, transparency: 30 })
    const dst = new PenState()
    dst.copyFrom(src)
    expect(dst.down).toBe(true)
    expect(dst.size).toBe(9)
    expect(dst.color).toBeCloseTo(20, 5)
    expect(dst.transparency).toBe(30)
    expect(dst.rgb).toBe(src.rgb)
  })
})

describe('PenLayer', () => {
  const dot = { kind: 'dot', x: 0, y: 0, color: 0, alpha: 1, size: 1 } as const

  it('drains once and comes back empty, like the sound queue', () => {
    const l = new PenLayer()
    l.push({ ...dot })
    expect(l.drain()).toHaveLength(1)
    expect(l.drain()).toEqual([])
  })

  it('caps a single frame and drops the overflow', () => {
    const l = new PenLayer()
    for (let i = 0; i < MAX_OPS_PER_FRAME + 500; i++) l.push({ ...dot })
    expect(l.drain()).toHaveLength(MAX_OPS_PER_FRAME)
  })

  it('the cap resets every frame', () => {
    const l = new PenLayer()
    for (let i = 0; i < MAX_OPS_PER_FRAME; i++) l.push({ ...dot })
    l.drain()
    l.push({ ...dot })
    expect(l.drain()).toHaveLength(1)
  })

  it('clear throws away everything queued before it', () => {
    const l = new PenLayer()
    l.push({ ...dot })
    l.push({ ...dot })
    l.clear()
    expect(l.drain()).toEqual([{ kind: 'clear' }])
  })

  it('clear still lands when the frame is already full', () => {
    const l = new PenLayer()
    for (let i = 0; i < MAX_OPS_PER_FRAME + 10; i++) l.push({ ...dot })
    l.clear()
    expect(l.drain()).toEqual([{ kind: 'clear' }])
  })
})

describe('readPenSettings', () => {
  it('accepts a partial settings object', () => {
    expect(readPenSettings('setPen', { color: 50, saturation: 80 })).toEqual({ color: 50, saturation: 80 })
  })

  it('rejects a non-object', () => {
    expect(() => readPenSettings('setPen', 5)).toThrow(
      '`setPen` needs a list of pen settings, like `sprite.setPen({ color: 50 })` — you gave it 5.',
    )
    expect(() => readPenSettings('setPen', 'red')).toThrow(FriendlyError)
    expect(() => readPenSettings('setPen', [1, 2])).toThrow(FriendlyError)
  })

  it('rejects an empty object', () => {
    expect(() => readPenSettings('setPen', {})).toThrow(
      '`setPen` needs at least one pen setting, like `sprite.setPen({ color: 50 })`.',
    )
  })

  it('names the settings it knows when given a wrong one', () => {
    expect(() => readPenSettings('setPen', { colour: 50 })).toThrow(
      '`setPen` doesn\'t know the pen setting "colour". You can set "color", "saturation", "brightness" and "transparency".',
    )
  })

  it('points size at its own function, because that is the likely confusion', () => {
    expect(() => readPenSettings('setPen', { size: 5 })).toThrow(
      "`setPen` changes the pen's colors — to change how thick it is, use `sprite.setPenSize(5)`.",
    )
    expect(() => readPenSettings('changePen', { size: 5 })).toThrow(
      "`changePen` changes the pen's colors — to change how thick it is, use `sprite.changePenSize(2)`.",
    )
  })

  it('rejects a non-number value', () => {
    expect(() => readPenSettings('setPen', { color: 'a lot' })).toThrow('`setPen` needs a number')
  })
})
