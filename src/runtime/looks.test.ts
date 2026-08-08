import { describe, it, expect } from 'vitest'
import { Clock } from './clock'
import { SpriteModel, type Costume } from './spriteModel'
import { StageModel } from './stageModel'
import { FriendlyError } from './errors'

const costumes: Costume[] = [
  { name: 'cat-a', width: 20, height: 20, source: 'library:cat-a' },
  { name: 'cat-b', width: 20, height: 20, source: 'library:cat-b' },
]
const flush = () => Promise.resolve()

describe('SpriteModel looks', () => {
  it('say sets a bubble; timed say clears it after the time', async () => {
    const clock = new Clock()
    const s = new SpriteModel('Cat', costumes, clock)
    const done = s.say('Hello!', 2)
    expect(s.sayBubble).toEqual({ text: 'Hello!', kind: 'say' })
    clock.tick(2.1)
    await done
    expect(s.sayBubble).toBeNull()
  })

  it('a newer bubble is not cleared by an older timer', async () => {
    const clock = new Clock()
    const s = new SpriteModel('Cat', costumes, clock)
    const first = s.say('one', 1)
    s.say('two')
    clock.tick(1.1)
    await first
    expect(s.sayBubble).toEqual({ text: 'two', kind: 'say' })
  })

  it('switches costumes by name and errors helpfully on unknown names', () => {
    const clock = new Clock()
    const s = new SpriteModel('Cat', costumes, clock)
    s.switchCostume('cat-b')
    expect(s.currentCostume).toBe(1)
    s.nextCostume()
    expect(s.currentCostume).toBe(0)
    expect(() => s.switchCostume('dog')).toThrow(/cat-a/)
  })

  it('clamps size and validates effects', () => {
    const clock = new Clock()
    const s = new SpriteModel('Cat', costumes, clock)
    s.setSize(9999)
    expect(s.size).toBe(500)
    s.setSize(1)
    expect(s.size).toBe(5)
    s.setEffect('ghost', 50)
    expect(s.effects.ghost).toBe(50)
    expect(() => s.setEffect('sparkle', 1)).toThrow(FriendlyError)
    s.clearEffects()
    expect(s.effects).toEqual({})
  })
})

describe('StageModel', () => {
  it('switches backdrops and notifies', () => {
    const stage = new StageModel(costumes)
    const seen: string[] = []
    stage.onBackdropChange = name => seen.push(name)
    stage.switchBackdrop('cat-b')
    expect(stage.currentBackdrop).toBe(1)
    stage.nextBackdrop() // wraps to 0
    expect(stage.currentBackdrop).toBe(0)
    expect(seen).toEqual(['cat-b', 'cat-a'])
    expect(() => stage.switchBackdrop('nope')).toThrow(FriendlyError)
  })
})
