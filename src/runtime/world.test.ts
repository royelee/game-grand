import { describe, it, expect } from 'vitest'
import { World } from './world'
import { makeSpriteApi } from './spriteApi'
import type { Costume } from './spriteModel'
import { FriendlyError } from './errors'

const c20: Costume[] = [{ name: 'a', width: 20, height: 20, source: 'library:a' }]
const backdrop: Costume[] = [{ name: 'sky', width: 480, height: 360, source: 'library:sky' }]
const makeWorld = () => new World({ backdrops: backdrop, soundNames: ['meow'] })

describe('World', () => {
  it('broadcast fires message handlers', () => {
    const w = makeWorld()
    let heard = false
    w.bus.register('message:go', () => { heard = true })
    w.broadcast('go')
    expect(heard).toBe(true)
    expect(() => w.broadcast(42)).toThrow(FriendlyError)
  })

  it('clone copies state, is appended on top, and fires clone event', () => {
    const w = makeWorld()
    const cat = w.addSprite('Cat', c20)
    cat.goTo(50, 60)
    let cloned: unknown = null
    w.bus.register('clone:Cat', m => { cloned = m })
    const c = w.clone(cat)
    expect(c.isClone).toBe(true)
    expect(c.x).toBe(50)
    expect(cloned).toBe(c)
    expect(w.sprites[w.sprites.length - 1]).toBe(c)
    w.removeClone(c)
    expect(w.sprites).not.toContain(c)
    w.removeClone(cat) // originals are never removed
    expect(w.sprites).toContain(cat)
  })

  it('layer order: goToFront and goBack reorder the array', () => {
    const w = makeWorld()
    const a = w.addSprite('A', c20)
    const b = w.addSprite('B', c20)
    w.goToFront(a)
    expect(w.sprites).toEqual([b, a])
    w.goBack(a, 1)
    expect(w.sprites).toEqual([a, b])
  })

  it('clickAt hits the topmost visible sprite at the point', () => {
    const w = makeWorld()
    const a = w.addSprite('A', c20)
    const b = w.addSprite('B', c20) // same spot, on top
    const clicks: string[] = []
    w.bus.register('click:A', () => clicks.push('A'))
    w.bus.register('click:B', () => clicks.push('B'))
    w.clickAt(0, 0)
    b.hide()
    w.clickAt(0, 0)
    w.clickAt(200, 200) // empty space
    expect(clicks).toEqual(['B', 'A'])
  })

  it('tick fires update then advances the clock; stopAll halts everything', () => {
    const w = makeWorld()
    let updates = 0
    w.bus.register('update', () => updates++)
    w.tick(0.1)
    expect(updates).toBe(1)
    expect(w.clock.now).toBeCloseTo(0.1)
    w.stopAll()
    w.tick(0.1)
    expect(updates).toBe(1)
    expect(w.running).toBe(false)
  })

  it('timer tracks clock time and resets', () => {
    const w = makeWorld()
    w.tick(1.5)
    expect(w.timer).toBeCloseTo(1.5)
    w.resetTimer()
    expect(w.timer).toBe(0)
  })

  it('sounds queue into the snapshot and drain; playSoundUntilDone resolves on soundFinished', async () => {
    const w = makeWorld()
    w.playSound('meow')
    const done = w.playSoundUntilDone('meow')
    const snap = w.snapshot()
    expect(snap.sounds.map(s => s.name)).toEqual(['meow', 'meow'])
    expect(w.snapshot().sounds).toEqual([]) // drained
    let resolved = false
    done.then(() => { resolved = true })
    w.soundFinished(snap.sounds[1].id)
    await Promise.resolve()
    expect(resolved).toBe(true)
    expect(() => w.playSound('bark')).toThrow(/meow/)
  })
})

describe('sprite facade', () => {
  it('exposes delegated motion and world-aware sensing', () => {
    const w = makeWorld()
    const cat = w.addSprite('Cat', c20)
    const bat = w.addSprite('Bat', c20)
    const api = makeSpriteApi(cat, w)
    api.move(10)
    expect(api.x).toBeCloseTo(10)
    bat.goTo(15, 0)
    expect(api.touching('Bat')).toBe(true)
    expect(api.touching('edge')).toBe(false)
    expect(() => api.touching('Dog')).toThrow(/Bat/)
    expect(() => api.touching('mouse')).toThrow(FriendlyError)
    expect(() => api.touching('mouse')).toThrow(/edge/)
    w.mouse.x = 13
    w.mouse.y = 4
    expect(api.distanceTo('mouse')).toBeCloseTo(5)
    api.deleteClone() // original: no-op
    expect(w.sprites).toContain(cat)
  })
})
