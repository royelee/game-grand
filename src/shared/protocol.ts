import type { ScriptIssue } from '../runtime/executor'

export interface LoadedCostume {
  name: string
  width: number
  height: number
  dataUrl: string
}

export interface PayloadSprite {
  name: string
  x: number
  y: number
  size: number
  direction: number
  visible: boolean
  costumes: LoadedCostume[]
  currentCostume: number
  script: string
}

export interface RunPayload {
  sprites: PayloadSprite[]
  backdrops: LoadedCostume[]
  currentBackdrop: number
  sounds: { name: string; dataUrl: string }[]
  mainScript: string
}

/** iframe → parent */
export type HostMessage =
  | { type: 'ready' }
  | { type: 'log'; text: string }
  | { type: 'issue'; issue: ScriptIssue }
  | { type: 'stopped' }

/** parent → iframe */
export type IdeMessage = { type: 'run'; payload: RunPayload }

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function isHostMessage(v: unknown): v is HostMessage {
  if (!isObj(v)) return false
  switch (v.type) {
    case 'ready':
    case 'stopped':
      return true
    case 'log':
      return typeof v.text === 'string'
    case 'issue': {
      const i = v.issue
      return (
        isObj(i) &&
        typeof i.tab === 'string' &&
        typeof i.message === 'string' &&
        (i.line === null || typeof i.line === 'number')
      )
    }
    default:
      return false
  }
}

export function isIdeMessage(v: unknown): v is IdeMessage {
  return isObj(v) && v.type === 'run' && isObj(v.payload) && Array.isArray(v.payload.sprites)
}
