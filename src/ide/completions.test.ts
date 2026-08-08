import { describe, it, expect } from 'vitest'
import { completionsFor, spriteMemberCompletions } from './completions'
import { API_DEFS } from '../shared/apiDefs'

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

  it('member completions cover every sprite-scoped def and strip the prefix', () => {
    const members = spriteMemberCompletions()
    const spriteDefs = API_DEFS.filter(d => d.scope === 'sprite')
    expect(members).toHaveLength(spriteDefs.length)
    const move = members.find(m => m.label === 'move')!
    expect(move.insertText).toBe('move(10)')
    expect(move.documentation).toContain('Walk forward')
    expect(move.detail).toBe('sprite.move(steps)')
  })

  it('marks value-like entries as properties', () => {
    const x = spriteMemberCompletions().find(m => m.label === 'x')!
    expect(x.kind).toBe('property')
    const move = spriteMemberCompletions().find(m => m.label === 'move')!
    expect(move.kind).toBe('method')
  })
})
