import { describe, it, expect } from 'vitest'
import { parseProjectDocument, validateProject, MAX_PROJECT_BYTES, RESERVED_TAB_NAMES } from './projectSchema'
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

  it('rejects a currentCostume index out of range', () => {
    const project = good()
    const result = validateProject({
      ...project,
      sprites: [{ ...project.sprites[0], currentCostume: 999 }],
    })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/Cat/)
  })

  it('rejects a currentCostume that is not an integer', () => {
    const project = good()
    expect(
      validateProject({ ...project, sprites: [{ ...project.sprites[0], currentCostume: 1.5 }] }).ok,
    ).toBe(false)
  })

  it('rejects a sprite with an empty costumes array', () => {
    const project = good()
    expect(
      validateProject({ ...project, sprites: [{ ...project.sprites[0], costumes: [] }] }).ok,
    ).toBe(false)
  })

  it('rejects Infinity and -Infinity in numeric fields', () => {
    const project = good()
    expect(
      validateProject({ ...project, sprites: [{ ...project.sprites[0], x: Infinity }] }).ok,
    ).toBe(false)
    expect(
      validateProject({ ...project, sprites: [{ ...project.sprites[0], size: -Infinity }] }).ok,
    ).toBe(false)
  })

  it('rejects NaN in stage.currentBackdrop', () => {
    const project = good()
    expect(
      validateProject({ ...project, stage: { ...project.stage, currentBackdrop: NaN } }).ok,
    ).toBe(false)
  })

  it('rejects stage.currentBackdrop past the end of backdrops', () => {
    const project = good()
    const result = validateProject({
      ...project,
      stage: { ...project.stage, currentBackdrop: 999 },
    })
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a stage with empty backdrops array', () => {
    const project = good()
    expect(
      validateProject({ ...project, stage: { ...project.stage, backdrops: [] } }).ok,
    ).toBe(false)
  })

  it('rejects a sprite named "main"', () => {
    const project = good()
    const result = validateProject({
      ...project,
      sprites: [{ ...project.sprites[0], name: 'main' }],
    })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/main script/)
  })

  it('rejects two sprites with the same name', () => {
    const project = good()
    const sprite = project.sprites[0]
    const result = validateProject({
      ...project,
      sprites: [sprite, { ...sprite }],
    })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/both called/)
  })

  it('accepts an empty project from createEmptyProject', () => {
    expect(validateProject(createEmptyProject()).ok).toBe(true)
  })
})

describe('module hygiene', () => {
  it('imports nothing, so the server can typecheck it in isolation', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./projectSchema.ts', import.meta.url), 'utf8')
    // Both forms matter: an `import` statement is the obvious way to pull in
    // another module, but `export { x } from './y'` (a re-export) makes tsc
    // resolve './y' too, just as surely — either one would silently
    // reintroduce the whole-client-graph build break this file exists to
    // prevent.
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/^\s*export\s+(type\s+)?[{*].*\sfrom\s/m)
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
