import { describe, it, expect } from 'vitest'
import { initialState, reducer, MAX_CONSOLE_LINES } from './store'
import { createEmptyProject, addSprite, type AssetRef } from '../shared/project'

const costume: AssetRef = { name: 'cat-a', source: 'library:cat-a' }
const withCat = () => initialState(addSprite(createEmptyProject(), 'Cat', [costume]))

describe('ide reducer', () => {
  it('starts on the main tab, not running, console empty', () => {
    const s = initialState(createEmptyProject())
    expect(s).toMatchObject({ selectedTab: 'main', running: false, console: [], runId: 0 })
  })

  it('adds a sprite, uniquifies its name, and selects it', () => {
    let s = reducer(withCat(), { type: 'add-sprite', name: 'Cat', costumes: [costume] })
    expect(s.project.sprites.map(x => x.name)).toEqual(['Cat', 'Cat2'])
    expect(s.selectedTab).toBe('Cat2')
  })

  it('renames a sprite named after the main tab so it does not collide', () => {
    const s = reducer(initialState(createEmptyProject()), {
      type: 'add-sprite', name: 'main', costumes: [costume],
    })
    expect(s.project.sprites.map(x => x.name)).toEqual(['main2'])
    expect(s.selectedTab).toBe('main2')
  })

  it('rejects renaming a sprite onto the main tab', () => {
    let s = reducer(withCat(), { type: 'select-tab', tab: 'Cat' })
    const before = s
    s = reducer(s, { type: 'rename-sprite', from: 'Cat', to: 'main' })
    expect(s.project.sprites).toEqual(before.project.sprites)
    expect(s.selectedTab).toBe('Cat')
    expect(s.console.at(-1)?.kind).toBe('issue')
  })

  it('adds a backdrop without touching the selected tab', () => {
    const s = reducer(withCat(), {
      type: 'add-backdrop',
      ref: { name: 'night', source: 'library:night' },
    })
    expect(s.project.stage.backdrops.map(b => b.name)).toEqual(['blue-sky', 'night'])
    expect(s.project.stage.currentBackdrop).toBe(1)
    expect(s.selectedTab).toBe('main')
  })

  it('falls back to main when the selected sprite is deleted', () => {
    let s = reducer(withCat(), { type: 'select-tab', tab: 'Cat' })
    s = reducer(s, { type: 'delete-sprite', name: 'Cat' })
    expect(s.project.sprites).toEqual([])
    expect(s.selectedTab).toBe('main')
  })

  it('follows the selection through a rename and ignores duplicate names', () => {
    let s = reducer(withCat(), { type: 'select-tab', tab: 'Cat' })
    s = reducer(s, { type: 'rename-sprite', from: 'Cat', to: 'Kitty' })
    expect(s.selectedTab).toBe('Kitty')
    s = reducer(s, { type: 'add-sprite', name: 'Bat', costumes: [costume] })
    const before = s
    s = reducer(s, { type: 'rename-sprite', from: 'Bat', to: 'Kitty' })
    expect(s.project.sprites.map(x => x.name)).toEqual(before.project.sprites.map(x => x.name))
    expect(s.console.at(-1)?.kind).toBe('issue')
  })

  it('writes scripts to the right tab', () => {
    let s = reducer(withCat(), { type: 'set-script', tab: 'main', script: 'vars.score = 0' })
    s = reducer(s, { type: 'set-script', tab: 'Cat', script: 'onStart(() => {})' })
    expect(s.project.mainScript).toBe('vars.score = 0')
    expect(s.project.sprites[0].script).toBe('onStart(() => {})')
  })

  it('run clears the console, sets running, and bumps runId', () => {
    let s = reducer(withCat(), { type: 'log', text: 'stale' })
    s = reducer(s, { type: 'run' })
    expect(s).toMatchObject({ running: true, console: [], runId: 1 })
    s = reducer(s, { type: 'stop' })
    expect(s.running).toBe(false)
    expect(reducer(s, { type: 'run' }).runId).toBe(2)
  })

  it('appends logs and issues with a readable location', () => {
    let s = reducer(withCat(), { type: 'log', text: 'hello' })
    s = reducer(s, { type: 'issue', issue: { tab: 'Cat', line: 3, message: 'boom' } })
    expect(s.console[0]).toEqual({ kind: 'log', text: 'hello' })
    expect(s.console[1]).toEqual({ kind: 'issue', text: 'In Cat, line 3: boom' })
    s = reducer(s, { type: 'issue', issue: { tab: 'main', line: null, message: 'bad' } })
    expect(s.console[2].text).toBe('In main: bad')
    expect(reducer(s, { type: 'clear-console' }).console).toEqual([])
  })

  it('caps console growth, dropping the oldest lines and keeping the newest', () => {
    let s = withCat()
    for (let i = 0; i < MAX_CONSOLE_LINES + 10; i++) {
      s = reducer(s, { type: 'log', text: `line ${i}` })
    }
    expect(s.console).toHaveLength(MAX_CONSOLE_LINES)
    expect(s.console[0].text).toBe('line 10')
    expect(s.console.at(-1)?.text).toBe(`line ${MAX_CONSOLE_LINES + 9}`)
  })

  it('caps the console across mixed log and issue lines too', () => {
    let s = withCat()
    for (let i = 0; i < MAX_CONSOLE_LINES + 5; i++) {
      s = reducer(s, { type: 'issue', issue: { tab: 'main', line: null, message: `boom ${i}` } })
    }
    expect(s.console).toHaveLength(MAX_CONSOLE_LINES)
    expect(s.console.at(-1)?.text).toBe(`In main: boom ${MAX_CONSOLE_LINES + 4}`)
  })
})
