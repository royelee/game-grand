import { describe, it, expect } from 'vitest'
import { searchApi, groupByCategory, exampleSnippet, CATEGORY_ORDER } from './reference'
import { API_DEFS } from '../shared/apiDefs'

describe('reference search', () => {
  it('returns everything for an empty query', () => {
    expect(searchApi('')).toHaveLength(API_DEFS.length)
    expect(searchApi('   ')).toHaveLength(API_DEFS.length)
  })

  it('matches names case-insensitively', () => {
    expect(searchApi('MOVE').map(d => d.name)).toContain('move')
  })

  it('matches description text so kids can search by intent', () => {
    const hits = searchApi('bubble').map(d => d.name)
    expect(hits).toContain('say')
  })

  it('returns nothing for gibberish', () => {
    expect(searchApi('zzzznotathing')).toEqual([])
  })
})

describe('grouping', () => {
  it('groups in Scratch category order and drops empty groups', () => {
    const groups = groupByCategory(API_DEFS)
    expect(groups.map(g => g.category)).toEqual(CATEGORY_ORDER)
    const single = groupByCategory(API_DEFS.filter(d => d.category === 'Sound'))
    expect(single).toHaveLength(1)
    expect(single[0].category).toBe('Sound')
  })

  it('keeps every def exactly once', () => {
    const total = groupByCategory(API_DEFS).reduce((n, g) => n + g.defs.length, 0)
    expect(total).toBe(API_DEFS.length)
  })
})

describe('exampleSnippet', () => {
  it('leaves examples that already run alone', () => {
    const move = API_DEFS.find(d => d.name === 'move')!
    expect(exampleSnippet(move)).toBe('sprite.move(10)')
    const onStart = API_DEFS.find(d => d.name === 'onStart')!
    expect(exampleSnippet(onStart)).toBe(onStart.example)
  })

  it('wraps top-level await in a handler, because scripts are not async', () => {
    const glide = API_DEFS.find(d => d.name === 'glide')!
    expect(exampleSnippet(glide)).toBe(
      'onStart(async () => {\n  await sprite.glide(100, 100, 1)\n})',
    )
  })

  it('leaves no top-level await anywhere in the library', () => {
    for (const def of API_DEFS) {
      const firstLine = exampleSnippet(def).split('\n')[0]
      expect(firstLine.startsWith('await'), def.name).toBe(false)
    }
  })
})
