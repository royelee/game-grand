import type { LoadedCostume, RunPayload } from './protocol'
import type { Project, AssetRef, SpriteDef } from './projectSchema'
import { RESERVED_TAB_NAMES } from './projectSchema'

export type { AssetRef, SpriteDef, StageDef, Project } from './projectSchema'
export { RESERVED_TAB_NAMES }

export const DEFAULT_BACKDROP: AssetRef = { name: 'blue-sky', source: 'library:blue-sky' }

export function createEmptyProject(): Project {
  return {
    version: 1,
    name: 'Untitled game',
    sprites: [],
    stage: { backdrops: [DEFAULT_BACKDROP], currentBackdrop: 0 },
    sounds: [],
    mainScript: '',
  }
}

export function uniqueSpriteName(project: Project, desired: string): string {
  const taken = new Set([...project.sprites.map(s => s.name), ...RESERVED_TAB_NAMES])
  if (!taken.has(desired)) return desired
  let n = 2
  while (taken.has(`${desired}${n}`)) n++
  return `${desired}${n}`
}

/**
 * User code addresses costumes, backdrops, and sounds by name —
 * `playSound("meow")`, `stage.switchBackdrop("night")`. Two assets sharing a
 * name make that call ambiguous, and the Scratch library is full of real
 * collisions: `pop` is attached to 197 different sprites, and `Shark 2` alone
 * carries two distinct sounds both called `Water drop`. Suffix the newcomer
 * rather than letting one silently shadow the other.
 */
export function uniqueAssetName(taken: string[], desired: string): string {
  const used = new Set(taken)
  if (!used.has(desired)) return desired
  let n = 2
  while (used.has(`${desired}${n}`)) n++
  return `${desired}${n}`
}

export function addSprite(project: Project, name: string, costumes: AssetRef[]): Project {
  const unique: AssetRef[] = []
  for (const costume of costumes) {
    unique.push({ ...costume, name: uniqueAssetName(unique.map(c => c.name), costume.name) })
  }
  const sprite: SpriteDef = {
    name,
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    visible: true,
    costumes: unique,
    currentCostume: 0,
    script: '',
  }
  return { ...project, sprites: [...project.sprites, sprite] }
}

export function renameSprite(project: Project, from: string, to: string): Project {
  if (RESERVED_TAB_NAMES.includes(to)) {
    throw new Error(`"${to}" is the name of the main script, so a sprite can't use it.`)
  }
  if (project.sprites.some(s => s.name === to)) {
    throw new Error(`A sprite named "${to}" already exists.`)
  }
  return {
    ...project,
    sprites: project.sprites.map(s => (s.name === from ? { ...s, name: to } : s)),
  }
}

export function deleteSprite(project: Project, name: string): Project {
  return { ...project, sprites: project.sprites.filter(s => s.name !== name) }
}

export function addBackdrop(project: Project, ref: AssetRef): Project {
  const existing = project.stage.backdrops.findIndex(b => b.source === ref.source)
  if (existing !== -1) {
    return { ...project, stage: { ...project.stage, currentBackdrop: existing } }
  }
  const named = {
    ...ref,
    name: uniqueAssetName(project.stage.backdrops.map(b => b.name), ref.name),
  }
  const backdrops = [...project.stage.backdrops, named]
  return { ...project, stage: { backdrops, currentBackdrop: backdrops.length - 1 } }
}

export function addSound(project: Project, ref: AssetRef): Project {
  if (project.sounds.some(s => s.source === ref.source)) return project
  const named = { ...ref, name: uniqueAssetName(project.sounds.map(s => s.name), ref.name) }
  return { ...project, sounds: [...project.sounds, named] }
}

/*
 * Backdrops and sounds are addressed by index rather than by name.
 * `validateProject` enforces unique *sprite* names but never checks these two
 * lists, so a stored document can legitimately hold two backdrops called the
 * same thing — and those are exactly the projects that most need fixing here.
 */

/** Chooses the backdrop the game starts on. An out-of-range index is ignored. */
export function setCurrentBackdrop(project: Project, index: number): Project {
  if (index < 0 || index >= project.stage.backdrops.length) return project
  return { ...project, stage: { ...project.stage, currentBackdrop: index } }
}

function renamedAt(refs: AssetRef[], index: number, to: string, kind: string): AssetRef[] {
  if (refs.some((ref, i) => i !== index && ref.name === to)) {
    throw new Error(`A ${kind} named "${to}" already exists.`)
  }
  return refs.map((ref, i) => (i === index ? { ...ref, name: to } : ref))
}

export function renameBackdrop(project: Project, index: number, to: string): Project {
  const backdrops = renamedAt(project.stage.backdrops, index, to, 'backdrop')
  return { ...project, stage: { ...project.stage, backdrops } }
}

export function renameSound(project: Project, index: number, to: string): Project {
  return { ...project, sounds: renamedAt(project.sounds, index, to, 'sound') }
}

/**
 * Removes a backdrop, keeping `currentBackdrop` a valid index — the schema
 * rejects a project pointing at a backdrop it doesn't have. Deleting the
 * current one lands on whatever slid into its slot, or on the new last row if
 * it was the last. The stage must always keep at least one backdrop.
 */
export function deleteBackdrop(project: Project, index: number): Project {
  const { backdrops, currentBackdrop } = project.stage
  if (backdrops.length <= 1) {
    throw new Error('Your game needs at least one backdrop, so this one can’t be deleted.')
  }
  const remaining = backdrops.filter((_, i) => i !== index)
  const current =
    index < currentBackdrop
      ? currentBackdrop - 1
      : index === currentBackdrop
        ? Math.min(index, remaining.length - 1)
        : currentBackdrop
  return { ...project, stage: { backdrops: remaining, currentBackdrop: current } }
}

/** Removes a sound. Unlike backdrops, an empty sounds list is a valid project. */
export function deleteSound(project: Project, index: number): Project {
  return { ...project, sounds: project.sounds.filter((_, i) => i !== index) }
}

export function setScript(project: Project, tab: string, script: string): Project {
  if (tab === 'main') return { ...project, mainScript: script }
  return {
    ...project,
    sprites: project.sprites.map(s => (s.name === tab ? { ...s, script } : s)),
  }
}

/**
 * Flatten a project into the payload the iframe runs. `resolve` turns an
 * AssetRef into a costume with real pixel dimensions and a data URL — the
 * engine needs dimensions for collision boxes, and the sandboxed iframe
 * cannot load same-origin URLs into WebGL textures.
 */
export function toRunPayload(
  project: Project,
  resolve: (ref: AssetRef) => LoadedCostume,
): RunPayload {
  return {
    sprites: project.sprites.map(s => ({
      name: s.name,
      x: s.x,
      y: s.y,
      size: s.size,
      direction: s.direction,
      visible: s.visible,
      costumes: s.costumes.map(resolve),
      currentCostume: s.currentCostume,
      script: s.script,
    })),
    backdrops: project.stage.backdrops.map(resolve),
    currentBackdrop: project.stage.currentBackdrop,
    sounds: project.sounds.map(a => ({ name: a.name, dataUrl: resolve(a).dataUrl })),
    mainScript: project.mainScript,
  }
}
