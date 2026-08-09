import type { LoadedCostume, RunPayload } from './protocol'
import { RESERVED_TAB_NAMES } from './projectSchema'
export { RESERVED_TAB_NAMES }

/** A reference to an asset: `library:<id>` for built-ins, `data:` for uploads. */
export interface AssetRef {
  name: string
  source: string
}

export interface SpriteDef {
  name: string
  x: number
  y: number
  size: number
  direction: number
  visible: boolean
  costumes: AssetRef[]
  currentCostume: number
  script: string
}

export interface StageDef {
  backdrops: AssetRef[]
  currentBackdrop: number
}

export interface Project {
  version: 1
  name: string
  sprites: SpriteDef[]
  stage: StageDef
  sounds: AssetRef[]
  mainScript: string
}

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

export function addSprite(project: Project, name: string, costumes: AssetRef[]): Project {
  const sprite: SpriteDef = {
    name,
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    visible: true,
    costumes,
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
  const backdrops = [...project.stage.backdrops, ref]
  return { ...project, stage: { backdrops, currentBackdrop: backdrops.length - 1 } }
}

export function addSound(project: Project, ref: AssetRef): Project {
  if (project.sounds.some(s => s.source === ref.source)) return project
  return { ...project, sounds: [...project.sounds, ref] }
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
