import { describe, it, expect } from 'vitest'
import { parseProjectDocument, validateProject, MAX_PROJECT_BYTES } from './projectSchema'
import { addSprite, createEmptyProject, setScript } from './project'

const good = () => {
  let p = createEmptyProject()
  p = addSprite(p, 'Cat', [{ name: 'cat-a', source: 'library:cat-a' }])
  return setScript(p, 'Cat', 'onStart(() => {})')
}

describe('validateProject', () => {
  it('accepts a project the IDE actually produces', () => {
    const result = validateProject(good())
    expect(result.ok).toBe(true)
  })

  it('rejects non-objects', () => {
    expect(validateProject(null).ok).toBe(false)
    expect(validateProject('a string').ok).toBe(false)
    expect(validateProject([]).ok).toBe(false)
  })

  it('rejects an unknown version', () => {
    const result = validateProject({ ...good(), version: 2 })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/version/i)
  })

  it('rejects missing or wrongly-typed top-level fields', () => {
    const { name: _dropped, ...noName } = good()
    expect(validateProject(noName).ok).toBe(false)
    expect(validateProject({ ...good(), mainScript: 42 }).ok).toBe(false)
    expect(validateProject({ ...good(), sprites: 'nope' }).ok).toBe(false)
    expect(validateProject({ ...good(), stage: null }).ok).toBe(false)
  })

  it('rejects a malformed sprite and says which one', () => {
    const project = good()
    const result = validateProject({
      ...project,
      sprites: [{ ...project.sprites[0], x: 'over there' }],
    })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/Cat/)
  })

  it('rejects a sprite whose script is not a string', () => {
    const project = good()
    expect(
      validateProject({ ...project, sprites: [{ ...project.sprites[0], script: null }] }).ok,
    ).toBe(false)
  })

  it('rejects malformed asset refs', () => {
    const project = good()
    expect(
      validateProject({ ...project, sounds: [{ name: 'beep' }] }).ok,
    ).toBe(false)
  })
})

describe('parseProjectDocument', () => {
  it('parses valid json', () => {
    const result = parseProjectDocument(JSON.stringify(good()))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.sprites[0].name).toBe('Cat')
  })

  it('rejects json that will not parse', () => {
    const result = parseProjectDocument('{ not json')
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/could not be read/i)
  })

  it('rejects a document over the size cap before parsing it', () => {
    const huge = 'x'.repeat(MAX_PROJECT_BYTES + 1)
    const result = parseProjectDocument(huge)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/too big/i)
  })

  it('measures bytes, not characters', () => {
    // '☃' is three UTF-8 bytes, so a third as many characters still busts the
    // cap — counting characters here would let a document three times the
    // limit through.
    const overByBytes = '☃'.repeat(Math.ceil(MAX_PROJECT_BYTES / 3))
    expect(overByBytes.length).toBeLessThan(MAX_PROJECT_BYTES)
    expect(parseProjectDocument(overByBytes).ok).toBe(false)
  })
})
