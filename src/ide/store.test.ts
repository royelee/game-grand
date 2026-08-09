import { describe, it, expect } from 'vitest'
import { hasUnsavedWork, initialState, reducer, MAX_CONSOLE_LINES } from './store'
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

describe('saving', () => {
  it('starts with no project id and an idle save state', () => {
    const s = initialState(createEmptyProject())
    expect(s.projectId).toBeNull()
    expect(s.save).toEqual({ status: 'idle', message: null })
  })

  it('accepts a starting project id', () => {
    expect(initialState(createEmptyProject(), 'abc123').projectId).toBe('abc123')
  })

  it('renames the project without touching anything else', () => {
    const before = withCat()
    const after = reducer(before, { type: 'rename-project', name: 'Cat Chase' })
    expect(after.project.name).toBe('Cat Chase')
    expect(after.project.sprites).toEqual(before.project.sprites)
  })

  it('moves through saving to saved and records the id', () => {
    let s = reducer(withCat(), { type: 'saving' })
    expect(s.save.status).toBe('saving')
    s = reducer(s, { type: 'saved', id: 'abc123', token: s.saveToken })
    expect(s.projectId).toBe('abc123')
    expect(s.save).toEqual({ status: 'saved', message: null })
  })

  it('keeps the id when a later save fails, and surfaces why', () => {
    let s = withCat()
    s = reducer(s, { type: 'saved', id: 'abc123', token: s.saveToken })
    s = reducer(s, { type: 'save-failed', message: 'That game is too big to save.', token: s.saveToken })
    expect(s.projectId).toBe('abc123')
    expect(s.save).toEqual({ status: 'error', message: 'That game is too big to save.' })
  })

  it('replaces the whole project when one is loaded, and selects main', () => {
    const loaded = addSprite(createEmptyProject(), 'Bat', [costume])
    let s = reducer(withCat(), { type: 'select-tab', tab: 'Cat' })
    s = reducer(s, { type: 'project-loaded', id: 'xyz', project: loaded })
    expect(s.projectId).toBe('xyz')
    expect(s.project.sprites.map(x => x.name)).toEqual(['Bat'])
    expect(s.selectedTab).toBe('main')
    expect(s.save).toEqual({ status: 'saved', message: null })
  })

  it('an edit after saving returns the state to idle so Save is offered again', () => {
    const before = withCat()
    let s = reducer(before, { type: 'saved', id: 'abc123', token: before.saveToken })
    s = reducer(s, { type: 'set-script', tab: 'main', script: 'vars.score = 0' })
    expect(s.save.status).toBe('idle')
  })
})

describe('save token invalidation', () => {
  it('ignores a stale save response that arrives after a different game was opened', () => {
    const loaded = addSprite(createEmptyProject(), 'Bat', [costume])
    let s = reducer(withCat(), { type: 'saved', id: 'A', token: 0 })
    s = reducer(s, { type: 'saving' })
    s = reducer(s, { type: 'project-loaded', id: 'B', project: loaded })
    s = reducer(s, { type: 'saved', id: 'A', token: 0 })
    expect(s.projectId).toBe('B')
    expect(s.project.sprites.map(x => x.name)).toEqual(['Bat'])
  })

  it('drops a stale save response that arrives after an edit, leaving status idle', () => {
    let s = reducer(withCat(), { type: 'saved', id: 'abc123', token: 0 })
    s = reducer(s, { type: 'saving' })
    const staleToken = s.saveToken
    s = reducer(s, { type: 'set-script', tab: 'main', script: 'vars.score = 0' })
    s = reducer(s, { type: 'saved', id: 'abc123', token: staleToken })
    expect(s.save.status).toBe('idle')
  })

  it('a stale save-failed never disturbs the project or the id, only the save status', () => {
    const s = reducer(withCat(), { type: 'saved', id: 'abc123', token: 0 })
    const after = reducer(s, { type: 'save-failed', message: 'stale error', token: s.saveToken - 1 })
    expect(after.projectId).toBe(s.projectId)
    expect(after.project).toEqual(s.project)
    expect(after.save).toEqual({ status: 'idle', message: null })
  })

  it('a stale save-failed after an edit never strands the UI on "Saving…"', () => {
    let s = reducer(withCat(), { type: 'saving' })
    const staleToken = s.saveToken
    s = reducer(s, { type: 'set-script', tab: 'main', script: 'vars.score = 0' })
    s = reducer(s, { type: 'save-failed', message: 'stale error', token: staleToken })
    expect(s.save.status).toBe('idle')
    expect(s.save.status).not.toBe('saving')
  })

  it('a save-failed whose token still matches shows the error', () => {
    let s = reducer(withCat(), { type: 'saving' })
    s = reducer(s, { type: 'save-failed', message: 'That game is too big to save.', token: s.saveToken })
    expect(s.save).toEqual({ status: 'error', message: 'That game is too big to save.' })
  })

  it('applies a save response whose token still matches', () => {
    let s = reducer(withCat(), { type: 'saving' })
    s = reducer(s, { type: 'saved', id: 'abc123', token: s.saveToken })
    expect(s.projectId).toBe('abc123')
    expect(s.save).toEqual({ status: 'saved', message: null })
  })

  it('project-loaded still yields status saved and bumps the token', () => {
    const loaded = addSprite(createEmptyProject(), 'Bat', [costume])
    const before = withCat()
    const s = reducer(before, { type: 'project-loaded', id: 'xyz', project: loaded })
    expect(s.save).toEqual({ status: 'saved', message: null })
    expect(s.saveToken).toBe(before.saveToken + 1)
  })
})

describe('hasUnsavedWork', () => {
  it('is false for a pristine, never-touched project', () => {
    expect(hasUnsavedWork(initialState(createEmptyProject()))).toBe(false)
  })

  it('is true after adding a backdrop alone', () => {
    const s = reducer(initialState(createEmptyProject()), {
      type: 'add-backdrop', ref: { name: 'night', source: 'library:night' },
    })
    expect(hasUnsavedWork(s)).toBe(true)
  })

  it('is true after renaming the project alone', () => {
    const s = reducer(initialState(createEmptyProject()), { type: 'rename-project', name: 'Cat Chase' })
    expect(hasUnsavedWork(s)).toBe(true)
  })

  it('is true after adding a sound alone', () => {
    const s = reducer(initialState(createEmptyProject()), {
      type: 'add-sound', ref: { name: 'meow', source: 'library:meow' },
    })
    expect(hasUnsavedWork(s)).toBe(true)
  })

  it('is false right after a project loads, since that matches the server', () => {
    const loaded = addSprite(createEmptyProject(), 'Bat', [costume])
    const s = reducer(initialState(createEmptyProject()), {
      type: 'project-loaded', id: 'xyz', project: loaded,
    })
    expect(hasUnsavedWork(s)).toBe(false)
  })
})
