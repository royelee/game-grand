import { describe, it, expect } from 'vitest'
import {
  createEmptyProject, addSprite, renameSprite, deleteSprite, setScript,
  uniqueSpriteName, addBackdrop, addSound, toRunPayload, RESERVED_TAB_NAMES,
  setCurrentBackdrop, renameBackdrop, deleteBackdrop, renameSound, deleteSound,
  type AssetRef, type Project,
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

  it('treats reserved tab names as taken when uniquifying a new sprite', () => {
    const p = createEmptyProject()
    expect(uniqueSpriteName(p, 'main')).toBe('main2')
    expect(RESERVED_TAB_NAMES).toContain('main')
  })

  it('rejects renaming a sprite onto a reserved tab name', () => {
    const p = withCat()
    expect(() => renameSprite(p, 'Cat', 'main')).toThrow(/main script/)
    expect(p.sprites[0].name).toBe('Cat')
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

describe('unique asset names', () => {
  it('suffixes a colliding sound name instead of shadowing the first', () => {
    let p = createEmptyProject()
    p = addSound(p, { name: 'Water drop', source: 'scratch:a.wav' })
    p = addSound(p, { name: 'Water drop', source: 'scratch:b.wav' })
    expect(p.sounds.map(s => s.name)).toEqual(['Water drop', 'Water drop2'])
  })

  it('still collapses the same asset added twice', () => {
    let p = createEmptyProject()
    p = addSound(p, { name: 'pop', source: 'scratch:same.wav' })
    p = addSound(p, { name: 'pop', source: 'scratch:same.wav' })
    expect(p.sounds).toHaveLength(1)
  })

  it('suffixes a colliding backdrop name', () => {
    let p = createEmptyProject()
    p = addBackdrop(p, { name: 'blue-sky', source: 'scratch:other.svg' })
    expect(p.stage.backdrops.map(b => b.name)).toEqual(['blue-sky', 'blue-sky2'])
  })

  it('still switches to an existing backdrop rather than adding it twice', () => {
    let p = createEmptyProject()
    p = addBackdrop(p, { name: 'night', source: 'scratch:n.svg' })
    p = addBackdrop(p, { name: 'night', source: 'scratch:n.svg' })
    expect(p.stage.backdrops).toHaveLength(2)
    expect(p.stage.currentBackdrop).toBe(1)
  })

  it('de-duplicates costume names within one sprite', () => {
    const p = addSprite(createEmptyProject(), 'Shark', [
      { name: 'shark-a', source: 'scratch:1.svg' },
      { name: 'shark-a', source: 'scratch:2.svg' },
    ])
    expect(p.sprites[0].costumes.map(c => c.name)).toEqual(['shark-a', 'shark-a2'])
  })
})

/** A project whose backdrops are `blue-sky, night, cave`, starting on `night`. */
function threeBackdrops(): Project {
  let p = addBackdrop(createEmptyProject(), { name: 'night', source: 'library:night' })
  p = addBackdrop(p, { name: 'cave', source: 'library:cave' })
  return setCurrentBackdrop(p, 1)
}

describe('managing backdrops', () => {
  it('changes which backdrop the game starts on', () => {
    const p = setCurrentBackdrop(threeBackdrops(), 2)
    expect(p.stage.currentBackdrop).toBe(2)
  })

  it('ignores an out-of-range index rather than corrupting the pointer', () => {
    const p = threeBackdrops()
    expect(setCurrentBackdrop(p, 9).stage.currentBackdrop).toBe(1)
    expect(setCurrentBackdrop(p, -1).stage.currentBackdrop).toBe(1)
  })

  it('renames a backdrop in place', () => {
    const p = renameBackdrop(threeBackdrops(), 1, 'evening')
    expect(p.stage.backdrops.map(b => b.name)).toEqual(['blue-sky', 'evening', 'cave'])
    expect(p.stage.backdrops[1].source).toBe('library:night')
  })

  it('rejects renaming a backdrop onto a name another backdrop already has', () => {
    expect(() => renameBackdrop(threeBackdrops(), 1, 'cave')).toThrow(/already/)
  })

  it('lets a backdrop keep its own name', () => {
    const p = renameBackdrop(threeBackdrops(), 1, 'night')
    expect(p.stage.backdrops[1].name).toBe('night')
  })

  it('shifts the pointer down when a backdrop before the current one goes', () => {
    const p = deleteBackdrop(threeBackdrops(), 0)
    expect(p.stage.backdrops.map(b => b.name)).toEqual(['night', 'cave'])
    expect(p.stage.currentBackdrop).toBe(0)
  })

  it('leaves the pointer alone when a backdrop after the current one goes', () => {
    const p = deleteBackdrop(threeBackdrops(), 2)
    expect(p.stage.backdrops.map(b => b.name)).toEqual(['blue-sky', 'night'])
    expect(p.stage.currentBackdrop).toBe(1)
  })

  it('lands on whatever slid into the slot when the current backdrop goes', () => {
    const p = deleteBackdrop(threeBackdrops(), 1)
    expect(p.stage.backdrops.map(b => b.name)).toEqual(['blue-sky', 'cave'])
    expect(p.stage.currentBackdrop).toBe(1)
  })

  it('lands on the new last row when the current backdrop was the last one', () => {
    const p = deleteBackdrop(setCurrentBackdrop(threeBackdrops(), 2), 2)
    expect(p.stage.backdrops.map(b => b.name)).toEqual(['blue-sky', 'night'])
    expect(p.stage.currentBackdrop).toBe(1)
  })

  it('refuses to delete the only backdrop, because the schema requires one', () => {
    expect(() => deleteBackdrop(createEmptyProject(), 0)).toThrow(/at least one/)
  })
})

describe('managing sounds', () => {
  function twoSounds(): Project {
    let p = addSound(createEmptyProject(), { name: 'meow', source: 'library:meow' })
    return addSound(p, { name: 'pop', source: 'library:pop' })
  }

  it('renames a sound in place', () => {
    const p = renameSound(twoSounds(), 0, 'cat noise')
    expect(p.sounds.map(s => s.name)).toEqual(['cat noise', 'pop'])
    expect(p.sounds[0].source).toBe('library:meow')
  })

  it('rejects renaming a sound onto a name another sound already has', () => {
    expect(() => renameSound(twoSounds(), 0, 'pop')).toThrow(/already/)
  })

  it('deletes a sound by index', () => {
    const p = deleteSound(twoSounds(), 0)
    expect(p.sounds.map(s => s.name)).toEqual(['pop'])
  })

  it('can empty the sounds list — unlike backdrops, none is a valid state', () => {
    expect(deleteSound(deleteSound(twoSounds(), 0), 0).sounds).toEqual([])
  })
})
