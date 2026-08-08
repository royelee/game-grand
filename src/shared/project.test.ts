import { describe, it, expect } from 'vitest'
import {
  createEmptyProject, addSprite, renameSprite, deleteSprite, setScript,
  uniqueSpriteName, addBackdrop, toRunPayload, type AssetRef, type Project,
} from './project'
import type { LoadedCostume } from './protocol'

const catCostume: AssetRef = { name: 'cat-a', source: 'library:cat-a' }
const resolve = (ref: AssetRef): LoadedCostume => ({
  name: ref.name, width: 40, height: 40, dataUrl: `data:image/svg+xml,${ref.name}`,
})

function withCat(): Project {
  return addSprite(createEmptyProject(), 'Cat', [catCostume])
}

describe('project model', () => {
  it('starts with a stage, no sprites, and an empty main script', () => {
    const p = createEmptyProject()
    expect(p.version).toBe(1)
    expect(p.sprites).toEqual([])
    expect(p.stage.backdrops.length).toBeGreaterThan(0)
    expect(p.mainScript).toBe('')
  })

  it('adds sprites with Scratch defaults and never mutates the input', () => {
    const before = createEmptyProject()
    const after = addSprite(before, 'Cat', [catCostume])
    expect(before.sprites).toEqual([])
    expect(after.sprites[0]).toMatchObject({
      name: 'Cat', x: 0, y: 0, size: 100, direction: 90, visible: true,
      currentCostume: 0, script: '',
    })
  })

  it('makes duplicate names unique', () => {
    let p = withCat()
    expect(uniqueSpriteName(p, 'Cat')).toBe('Cat2')
    p = addSprite(p, uniqueSpriteName(p, 'Cat'), [catCostume])
    expect(uniqueSpriteName(p, 'Cat')).toBe('Cat3')
    expect(uniqueSpriteName(p, 'Bat')).toBe('Bat')
  })

  it('renames a sprite and deletes by name', () => {
    let p = setScript(withCat(), 'Cat', 'onStart(() => {})')
    p = renameSprite(p, 'Cat', 'Kitty')
    expect(p.sprites[0].name).toBe('Kitty')
    expect(p.sprites[0].script).toBe('onStart(() => {})')
    p = deleteSprite(p, 'Kitty')
    expect(p.sprites).toEqual([])
  })

  it('rejects renaming onto an existing name', () => {
    const p = addSprite(withCat(), 'Bat', [catCostume])
    expect(() => renameSprite(p, 'Bat', 'Cat')).toThrow(/already/)
  })

  it('sets the main script and per-sprite scripts by tab', () => {
    let p = withCat()
    p = setScript(p, 'main', 'vars.score = 0')
    p = setScript(p, 'Cat', 'onStart(() => {})')
    expect(p.mainScript).toBe('vars.score = 0')
    expect(p.sprites[0].script).toBe('onStart(() => {})')
  })

  it('adds a backdrop and selects it, without duplicating a known source', () => {
    const night: AssetRef = { name: 'night', source: 'library:night' }
    let p = addBackdrop(createEmptyProject(), night)
    expect(p.stage.backdrops.map(b => b.name)).toEqual(['blue-sky', 'night'])
    expect(p.stage.currentBackdrop).toBe(1)
    p = addBackdrop(p, { name: 'blue-sky', source: 'library:blue-sky' })
    expect(p.stage.backdrops).toHaveLength(2)
    expect(p.stage.currentBackdrop).toBe(0)
  })

  it('builds a run payload with every asset resolved', () => {
    const p = setScript(withCat(), 'main', 'vars.score = 0')
    const payload = toRunPayload(p, resolve)
    expect(payload.mainScript).toBe('vars.score = 0')
    expect(payload.sprites).toHaveLength(1)
    expect(payload.sprites[0].costumes[0]).toEqual({
      name: 'cat-a', width: 40, height: 40, dataUrl: 'data:image/svg+xml,cat-a',
    })
    expect(payload.backdrops[0].dataUrl).toContain('data:')
    expect(payload.sprites[0].script).toBe('')
  })
})
