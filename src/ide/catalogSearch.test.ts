import { describe, it, expect } from 'vitest'
import { TAG_CHIPS, itemsOfKind, loadCatalog, searchItems } from './catalogSearch'
import type { ScratchCatalog } from '../shared/scratchCatalog'

const catalog: ScratchCatalog = {
  source: 'scratch-gui@test',
  license: 'CC-BY-SA-4.0',
  sprites: [
    { name: 'Abby', tags: ['people'], costumes: [{ name: 'abby-a', md5ext: 'a1.svg', res: 1 }], sounds: [] },
    { name: 'Cat', tags: ['animals'], costumes: [{ name: 'cat-a', md5ext: 'c1.svg', res: 1 }], sounds: [] },
  ],
  costumes: [{ name: 'Ball', tags: ['sports'], md5ext: 'b1.svg', res: 1 }],
  backdrops: [{ name: 'Arctic', tags: ['outdoors', 'ice'], md5ext: 'd1.png', res: 2 }],
  sounds: [{ name: 'Meow', tags: ['animals'], md5ext: 'e1.wav', seconds: 0.85 }],
}

describe('itemsOfKind', () => {
  it('returns the list matching the kind', () => {
    expect(itemsOfKind(catalog, 'sprite')).toHaveLength(2)
    expect(itemsOfKind(catalog, 'backdrop')[0].name).toBe('Arctic')
    expect(itemsOfKind(catalog, 'sound')[0].name).toBe('Meow')
  })
})

describe('searchItems', () => {
  const sprites = itemsOfKind(catalog, 'sprite')

  it('returns everything when there is no query or tag', () => {
    expect(searchItems(sprites, '', null)).toHaveLength(2)
  })

  it('matches on name, case-insensitively', () => {
    expect(searchItems(sprites, 'abb', null).map(i => i.name)).toEqual(['Abby'])
  })

  it('matches on tag text too, so "animals" finds the Cat', () => {
    expect(searchItems(sprites, 'animals', null).map(i => i.name)).toEqual(['Cat'])
  })

  it('filters by a selected tag chip', () => {
    expect(searchItems(sprites, '', 'people').map(i => i.name)).toEqual(['Abby'])
  })

  it('applies query and tag together', () => {
    expect(searchItems(sprites, 'cat', 'people')).toEqual([])
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(searchItems(sprites, '  cat  ', null).map(i => i.name)).toEqual(['Cat'])
  })
})

describe('loadCatalog', () => {
  it('loads the catalog as json', async () => {
    const fetchFn = async () => ({ ok: true, json: async () => catalog }) as unknown as Response
    expect(await loadCatalog(fetchFn)).toEqual(catalog)
  })

  it('rejects a failed fetch with the status', async () => {
    const fetchFn = async () => ({ ok: false, status: 404 }) as unknown as Response
    await expect(loadCatalog(fetchFn)).rejects.toThrow(/404/)
  })
})

describe('TAG_CHIPS', () => {
  it('offers a short curated set, not all 379 tags', () => {
    expect(TAG_CHIPS.length).toBeLessThanOrEqual(10)
    expect(TAG_CHIPS).toContain('animals')
  })
})
