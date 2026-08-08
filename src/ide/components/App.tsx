import { useReducer } from 'react'
import { createEmptyProject } from '../../shared/project'
import { initialState, reducer } from '../store'
import { SpriteList } from './SpriteList'
import { StagePanel } from './StagePanel'

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState(createEmptyProject()))

  return (
    <div className="ide">
      <div className="panel">
        <div className="toolbar">
          <h1>{state.project.name}</h1>
          <button className="primary" disabled>▶ Run</button>
          <button className="danger" disabled>■ Stop</button>
        </div>
        <StagePanel
          runId={state.runId}
          running={false}
          payload={null}
          onIssue={issue => dispatch({ type: 'issue', issue })}
          onLog={text => dispatch({ type: 'log', text })}
          onStopped={() => dispatch({ type: 'stop' })}
        />
        <SpriteList
          project={state.project}
          selectedTab={state.selectedTab}
          costumeUrl={() => ''}
          onSelect={tab => dispatch({ type: 'select-tab', tab })}
          onAdd={() => dispatch({ type: 'add-sprite', name: 'Sprite', costumes: [] })}
          onRename={() => {}}
          onDelete={name => dispatch({ type: 'delete-sprite', name })}
        />
      </div>
      <div className="panel">
        <div className="toolbar"><h1>Code</h1></div>
        <div className="stage-empty">Editor arrives in Task 7</div>
      </div>
    </div>
  )
}
