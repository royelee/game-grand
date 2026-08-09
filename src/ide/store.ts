import {
  addBackdrop, addSound, addSprite, deleteSprite, renameSprite, setScript, uniqueSpriteName,
  type AssetRef, type Project,
} from '../shared/project'
import type { ScriptIssue } from '../runtime/executor'

export interface ConsoleLine {
  kind: 'log' | 'issue'
  text: string
}

export interface IdeState {
  project: Project
  selectedTab: string
  running: boolean
  runId: number
  console: ConsoleLine[]
  projectId: string | null
  save: { status: 'idle' | 'saving' | 'saved' | 'error'; message: string | null }
  /** Bumped whenever an in-flight save goes stale — an edit, or a different game opened. */
  saveToken: number
}

export type IdeAction =
  | { type: 'select-tab'; tab: string }
  | { type: 'add-sprite'; name: string; costumes: AssetRef[] }
  | { type: 'add-backdrop'; ref: AssetRef }
  | { type: 'add-sound'; ref: AssetRef }
  | { type: 'delete-sprite'; name: string }
  | { type: 'rename-sprite'; from: string; to: string }
  | { type: 'set-script'; tab: string; script: string }
  | { type: 'run' }
  | { type: 'stop' }
  | { type: 'log'; text: string }
  | { type: 'issue'; issue: ScriptIssue }
  | { type: 'clear-console' }
  | { type: 'rename-project'; name: string }
  | { type: 'saving' }
  | { type: 'saved'; id: string; token: number }
  | { type: 'save-failed'; message: string; token: number }
  | { type: 'project-loaded'; id: string; project: Project }

export function initialState(project: Project, projectId: string | null = null): IdeState {
  return {
    project,
    selectedTab: 'main',
    running: false,
    runId: 0,
    console: [],
    projectId,
    save: { status: 'idle', message: null },
    saveToken: 0,
  }
}

/**
 * A script logging inside `onUpdate` can produce ~60 dispatches/sec. Without
 * a cap, an unbounded array re-renders the whole IDE and eventually exhausts
 * memory on a run left going.
 */
export const MAX_CONSOLE_LINES = 500

function pushLine(lines: ConsoleLine[], line: ConsoleLine): ConsoleLine[] {
  const next = [...lines, line]
  return next.length > MAX_CONSOLE_LINES ? next.slice(next.length - MAX_CONSOLE_LINES) : next
}

function issueText(issue: ScriptIssue): string {
  return issue.line === null
    ? `In ${issue.tab}: ${issue.message}`
    : `In ${issue.tab}, line ${issue.line}: ${issue.message}`
}

function applyAction(state: IdeState, action: IdeAction): IdeState {
  switch (action.type) {
    case 'select-tab':
      return { ...state, selectedTab: action.tab }

    case 'add-sprite': {
      const name = uniqueSpriteName(state.project, action.name)
      return {
        ...state,
        project: addSprite(state.project, name, action.costumes),
        selectedTab: name,
      }
    }

    case 'add-backdrop':
      return { ...state, project: addBackdrop(state.project, action.ref) }

    case 'add-sound':
      return { ...state, project: addSound(state.project, action.ref) }

    case 'delete-sprite':
      return {
        ...state,
        project: deleteSprite(state.project, action.name),
        selectedTab: state.selectedTab === action.name ? 'main' : state.selectedTab,
      }

    case 'rename-sprite':
      try {
        return {
          ...state,
          project: renameSprite(state.project, action.from, action.to),
          selectedTab: state.selectedTab === action.from ? action.to : state.selectedTab,
        }
      } catch (err) {
        return {
          ...state,
          console: [
            ...state.console,
            { kind: 'issue', text: err instanceof Error ? err.message : String(err) },
          ],
        }
      }

    case 'set-script':
      return { ...state, project: setScript(state.project, action.tab, action.script) }

    case 'run':
      return { ...state, running: true, runId: state.runId + 1, console: [] }

    case 'stop':
      return { ...state, running: false }

    case 'log':
      return { ...state, console: pushLine(state.console, { kind: 'log', text: action.text }) }

    case 'issue':
      return {
        ...state,
        console: pushLine(state.console, { kind: 'issue', text: issueText(action.issue) }),
      }

    case 'clear-console':
      return { ...state, console: [] }

    case 'rename-project':
      return { ...state, project: { ...state.project, name: action.name } }

    case 'saving':
      return { ...state, save: { status: 'saving', message: null } }

    case 'saved':
      if (action.token !== state.saveToken) {
        // A save that finished after an edit, or after another game was
        // opened. Never claim the work is safe, and never reattach the old
        // game's id — that would aim the next Save at the wrong game.
        return { ...state, save: { status: 'idle', message: null } }
      }
      return { ...state, projectId: action.id, save: { status: 'saved', message: null } }

    case 'save-failed':
      if (action.token !== state.saveToken) return state
      return { ...state, save: { status: 'error', message: action.message } }

    case 'project-loaded':
      return {
        ...state,
        project: action.project,
        projectId: action.id,
        selectedTab: 'main',
        save: { status: 'saved', message: null },
        console: [],
      }
  }
}

/**
 * Any action that edits the project must drop a `saved` status back to
 * `idle`, so the UI stops claiming the work is safe once it no longer
 * matches what's on the server.
 */
const EDITING_ACTIONS = new Set([
  'add-sprite', 'add-backdrop', 'add-sound', 'delete-sprite', 'rename-sprite',
  'set-script', 'rename-project',
])

/**
 * Anything that makes an in-flight save's eventual result meaningless: an
 * edit landed before it finished, or a different game was opened entirely.
 * Bumping the token here lets `saved`/`save-failed` recognize and discard a
 * response that arrives after one of these — see the `token` check in
 * `applyAction`.
 */
const INVALIDATES_SAVE = new Set([...EDITING_ACTIONS, 'project-loaded'])

export function reducer(state: IdeState, action: IdeAction): IdeState {
  const next = applyAction(state, action)
  if (!INVALIDATES_SAVE.has(action.type)) return next
  const bumped = { ...next, saveToken: next.saveToken + 1 }
  if (bumped.save.status === 'saved' && EDITING_ACTIONS.has(action.type)) {
    return { ...bumped, save: { status: 'idle', message: null } }
  }
  return bumped
}
