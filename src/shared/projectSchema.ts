import type { Project } from './project'

export const MAX_PROJECT_BYTES = 10 * 1024 * 1024

export type ValidationResult =
  | { ok: true; project: Project }
  | { ok: false; error: string }

const fail = (error: string): ValidationResult => ({ ok: false, error })

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAssetRef(value: unknown): boolean {
  return isPlainObject(value) && typeof value.name === 'string' && typeof value.source === 'string'
}

function spriteError(value: unknown, index: number): string | null {
  if (!isPlainObject(value)) return `Sprite ${index + 1} is not readable.`
  const label = typeof value.name === 'string' ? `"${value.name}"` : `${index + 1}`
  if (typeof value.name !== 'string') return `Sprite ${label} has no name.`
  for (const key of ['x', 'y', 'size', 'direction', 'currentCostume'] as const) {
    if (typeof value[key] !== 'number' || Number.isNaN(value[key])) {
      return `Sprite ${label} has a bad ${key}.`
    }
  }
  if (typeof value.visible !== 'boolean') return `Sprite ${label} has a bad visible flag.`
  if (typeof value.script !== 'string') return `Sprite ${label} has no script.`
  if (!Array.isArray(value.costumes) || !value.costumes.every(isAssetRef)) {
    return `Sprite ${label} has a bad costume.`
  }
  return null
}

/** Validates an already-parsed value against the project shape. */
export function validateProject(value: unknown): ValidationResult {
  if (!isPlainObject(value)) return fail("That isn't a game this app can open.")
  if (value.version !== 1) {
    return fail("That game was made by a different version of this app (bad version).")
  }
  if (typeof value.name !== 'string') return fail('That game has no name.')
  if (typeof value.mainScript !== 'string') return fail('That game has no main script.')

  if (!Array.isArray(value.sprites)) return fail('That game has no sprites list.')
  for (const [index, sprite] of value.sprites.entries()) {
    const error = spriteError(sprite, index)
    if (error) return fail(error)
  }

  const stage = value.stage
  if (!isPlainObject(stage)) return fail('That game has no stage.')
  if (!Array.isArray(stage.backdrops) || !stage.backdrops.every(isAssetRef)) {
    return fail('That game has a bad backdrop.')
  }
  if (typeof stage.currentBackdrop !== 'number') return fail('That game has a bad backdrop choice.')

  if (!Array.isArray(value.sounds) || !value.sounds.every(isAssetRef)) {
    return fail('That game has a bad sound.')
  }

  return { ok: true, project: value as unknown as Project }
}

/** Parses a stored/uploaded document, enforcing the size cap first. */
export function parseProjectDocument(raw: string): ValidationResult {
  if (Buffer.byteLength(raw, 'utf8') > MAX_PROJECT_BYTES) {
    return fail('That game is too big to save. Try using smaller pictures.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('That game could not be read.')
  }
  return validateProject(parsed)
}
