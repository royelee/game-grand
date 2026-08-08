import {
  addBackdrop, addSprite, deleteSprite, renameSprite, setScript, uniqueSpriteName,
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
}

export type IdeAction =
  | { type: 'select-tab'; tab: string }
  | { type: 'add-sprite'; name: string; costumes: AssetRef[] }
  | { type: 'add-backdrop'; ref: AssetRef }
  | { type: 'delete-sprite'; name: string }
  | { type: 'rename-sprite'; from: string; to: string }
  | { type: 'set-script'; tab: string; script: string }
  | { type: 'run' }
  | { type: 'stop' }
  | { type: 'log'; text: string }
  | { type: 'issue'; issue: ScriptIssue }
  | { type: 'clear-console' }

export function initialState(project: Project): IdeState {
  return { project, selectedTab: 'main', running: false, runId: 0, console: [] }
}

function issueText(issue: ScriptIssue): string {
  return issue.line === null
    ? `In ${issue.tab}: ${issue.message}`
    : `In ${issue.tab}, line ${issue.line}: ${issue.message}`
}

export function reducer(state: IdeState, action: IdeAction): IdeState {
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
      return { ...state, console: [...state.console, { kind: 'log', text: action.text }] }

    case 'issue':
      return {
        ...state,
        console: [...state.console, { kind: 'issue', text: issueText(action.issue) }],
      }

    case 'clear-console':
      return { ...state, console: [] }
  }
}
