import { describe, it, expect } from 'vitest'
import { API_DEFS } from './apiDefs'
import { World } from '../runtime/world'
import { makeSpriteApi } from '../runtime/spriteApi'
import { Executor } from '../runtime/executor'

describe('API definitions', () => {
  const world = new World({
    backdrops: [{ name: 'sky', width: 480, height: 360, source: 'library:sky' }],
    soundNames: ['meow'],
  })
  const model = world.addSprite('Cat', [{ name: 'a', width: 20, height: 20, source: 'library:a' }])
  const facade = makeSpriteApi(model, world) as unknown as Record<string, unknown>
  const globals = new Executor(world, { onIssue: () => {}, onLog: () => {} }).globalNames()

  it('every def is fully written', () => {
    expect(API_DEFS.length).toBeGreaterThanOrEqual(40)
    for (const d of API_DEFS) {
      expect(d.name.length, d.name).toBeGreaterThan(0)
      expect(d.signature.length, d.name).toBeGreaterThan(0)
      expect(d.description.length, d.name).toBeGreaterThan(10)
      expect(d.example.length, d.name).toBeGreaterThan(0)
    }
  })

  it('every sprite-scoped def exists on the sprite facade', () => {
    for (const d of API_DEFS.filter(d => d.scope === 'sprite')) {
      expect(d.name in facade, `sprite.${d.name} missing`).toBe(true)
    }
  })

  it('every global-scoped def is injected by the executor', () => {
    for (const d of API_DEFS.filter(d => d.scope === 'global')) {
      const root = d.name.split('.')[0]
      expect(globals.includes(root), `global ${d.name} missing`).toBe(true)
    }
  })

  it('covers every Scratch category', () => {
    const cats = new Set(API_DEFS.map(d => d.category))
    for (const c of ['Motion', 'Looks', 'Sound', 'Events', 'Sensing', 'Control', 'Stage', 'Variables']) {
      expect(cats.has(c as never), c).toBe(true)
    }
  })
})
