import { describe, it, expect } from 'vitest'
import { addSprite, createEmptyProject, setScript, type Project } from '../shared/project'
import { joinTabNames, scriptsReferencing } from './references'

const costume = { name: 'cat-a', source: 'library:cat-a' }

function withScripts(main: string, cat: string, bat = ''): Project {
  let p = addSprite(createEmptyProject(), 'Cat', [costume])
  p = addSprite(p, 'Bat', [costume])
  p = setScript(p, 'main', main)
  p = setScript(p, 'Cat', cat)
  return setScript(p, 'Bat', bat)
}

describe('scriptsReferencing', () => {
  it('finds the name in the main script and in sprite scripts, in tab order', () => {
    const p = withScripts(
      'onBackdropSwitch("night", () => {})',
      'onStart(() => stage.switchBackdrop("night"))',
    )
    expect(scriptsReferencing(p, 'night')).toEqual(['main', 'Cat'])
  })

  it('matches single-quoted literals too', () => {
    const p = withScripts('', "onStart(() => playSound('meow'))")
    expect(scriptsReferencing(p, 'meow')).toEqual(['Cat'])
  })

  it('does not match a bare or embedded occurrence of the name', () => {
    const p = withScripts('const meow = 1', 'sprite.say("sayMeow and meowLoudly")')
    expect(scriptsReferencing(p, 'meow')).toEqual([])
  })

  it('returns nothing when no script mentions the name', () => {
    expect(scriptsReferencing(withScripts('', ''), 'night')).toEqual([])
  })

  it('handles a name carrying quotes or regex metacharacters', () => {
    const p = withScripts('', `playSound("Boing! (loud) [2]")`)
    expect(scriptsReferencing(p, 'Boing! (loud) [2]')).toEqual(['Cat'])
    expect(scriptsReferencing(p, 'Boing. .loud. .2.')).toEqual([])
  })

  it('reports every sprite that uses it', () => {
    const p = withScripts('', 'playSound("pop")', "playSound('pop')")
    expect(scriptsReferencing(p, 'pop')).toEqual(['Cat', 'Bat'])
  })
})

describe('joinTabNames', () => {
  it('reads as a sentence for one, two, and three tabs', () => {
    expect(joinTabNames([])).toBe('')
    expect(joinTabNames(['main'])).toBe('main')
    expect(joinTabNames(['main', 'Cat'])).toBe('main and Cat')
    expect(joinTabNames(['main', 'Cat', 'Bat'])).toBe('main, Cat and Bat')
  })
})
