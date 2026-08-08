import { describe, it, expect } from 'vitest'
import {
  completionsFor, spriteMemberCompletions, stageMemberCompletions, paramsOf,
} from './completions'
import { API_DEFS } from '../shared/apiDefs'

const find = (items: ReturnType<typeof completionsFor>, label: string) =>
  items.find(i => i.label === label)!

describe('completions', () => {
  it('offers every global to main scripts, and no sprite-only members', () => {
    const labels = completionsFor('main').map(c => c.label)
    expect(labels).toContain('onStart')
    expect(labels).toContain('broadcast')
    expect(labels).toContain('vars')
    expect(labels).not.toContain('move')
  })

  it('offers globals plus the sprite object in sprite scripts', () => {
    const labels = completionsFor('sprite').map(c => c.label)
    expect(labels).toContain('sprite')
    expect(labels).toContain('onClick')
    expect(labels).toContain('onStart')
  })

  it('lists dotted globals under their root only once', () => {
    const labels = completionsFor('main').map(c => c.label)
    expect(labels.filter(l => l === 'stage')).toHaveLength(1)
  })

  it('member completions cover every sprite-scoped def', () => {
    const members = spriteMemberCompletions()
    const spriteDefs = API_DEFS.filter(d => d.scope === 'sprite')
    expect(members).toHaveLength(spriteDefs.length)
  })
})

describe('paramsOf', () => {
  it('reads parameter names out of a signature', () => {
    expect(paramsOf('sprite.say(text, seconds?)')).toEqual(['text', 'seconds?'])
    expect(paramsOf('sprite.ifOnEdgeBounce()')).toEqual([])
    expect(paramsOf('sprite.x')).toEqual([])
    expect(paramsOf('await sprite.glide(x, y, seconds)')).toEqual(['x', 'y', 'seconds'])
  })
})

describe('insert text', () => {
  it('gives handlers a complete arrow function with the cursor in the body', () => {
    expect(find(completionsFor('main'), 'onStart').insertText).toBe('onStart(() => {\n  $0\n})')
    expect(find(completionsFor('main'), 'onKeyPress').insertText).toBe(
      'onKeyPress("$1", () => {\n  $0\n})',
    )
  })

  it('gives other calls parens with the cursor inside', () => {
    expect(find(spriteMemberCompletions(), 'move').insertText).toBe('move($0)')
    expect(find(spriteMemberCompletions(), 'ifOnEdgeBounce').insertText).toBe('ifOnEdgeBounce()')
  })

  it('inserts values and namespaces as bare identifiers', () => {
    expect(find(spriteMemberCompletions(), 'x').insertText).toBe('x')
    expect(find(completionsFor('main'), 'timer').insertText).toBe('timer')
    expect(find(completionsFor('main'), 'mouse').insertText).toBe('mouse')
    expect(find(completionsFor('main'), 'vars').insertText).toBe('vars')
    expect(find(completionsFor('main'), 'stage').insertText).toBe('stage')
  })

  it('offers stage members after stage.', () => {
    const labels = stageMemberCompletions().map(c => c.label)
    expect(labels).toEqual(['switchBackdrop', 'nextBackdrop'])
    expect(find(stageMemberCompletions(), 'switchBackdrop').insertText).toBe('switchBackdrop($0)')
  })

  it('never inserts unbalanced brackets — nothing a kid must repair', () => {
    const all = [
      ...completionsFor('main'),
      ...completionsFor('sprite'),
      ...spriteMemberCompletions(),
      ...stageMemberCompletions(),
    ]
    expect(all.length).toBeGreaterThan(API_DEFS.length / 2)
    for (const c of all) {
      const opens = (c.insertText.match(/[({]/g) ?? []).length
      const closes = (c.insertText.match(/[)}]/g) ?? []).length
      expect(closes, `${c.label}: ${c.insertText}`).toBe(opens)
    }
  })

  it('never re-inserts a prefix the user already typed', () => {
    for (const c of spriteMemberCompletions()) {
      expect(c.insertText, c.label).not.toContain('sprite.')
    }
    for (const c of stageMemberCompletions()) {
      expect(c.insertText, c.label).not.toContain('stage.')
    }
  })

  it('marks methods and values distinctly', () => {
    expect(find(spriteMemberCompletions(), 'move').kind).toBe('method')
    expect(find(spriteMemberCompletions(), 'x').kind).toBe('property')
  })
})
