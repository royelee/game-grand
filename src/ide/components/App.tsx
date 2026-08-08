import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { createEmptyProject, toRunPayload, type AssetRef } from '../../shared/project'
import type { RunPayload } from '../../shared/protocol'
import {
  loadManifest, makeResolver, preloadLibrary, refsForEntry,
  type AssetStore, type LibraryEntry, type LibraryManifest,
} from '../library'
import { initialState, reducer } from '../store'
import { measureImage, downscale, readFileAsDataUrl } from '../upload'
import { ApiDrawer } from './ApiDrawer'
import { CodeEditor } from './CodeEditor'
import { ConsolePane } from './ConsolePane'
import { LibraryDialog } from './LibraryDialog'
import { SpriteList } from './SpriteList'
import { StagePanel } from './StagePanel'

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState(createEmptyProject()))
  const [manifest, setManifest] = useState<LibraryManifest | null>(null)
  const [store, setStore] = useState<AssetStore>(new Map())
  const [payload, setPayload] = useState<RunPayload | null>(null)
  const [picking, setPicking] = useState<'costume' | 'backdrop' | null>(null)
  const [showApi, setShowApi] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const m = await loadManifest()
        const loaded = await preloadLibrary(m)
        if (cancelled) return
        setManifest(m)
        setStore(prev => new Map([...prev, ...loaded]))
      } catch (err) {
        dispatch({
          type: 'issue',
          issue: { tab: 'main', line: null, message: err instanceof Error ? err.message : String(err) },
        })
      }
    })()
    return () => { cancelled = true }
  }, [])

  const resolver = useMemo(() => (manifest ? makeResolver(store) : null), [manifest, store])

  const costumeUrl = useCallback(
    (source: string) => store.get(source)?.dataUrl ?? '',
    [store],
  )

  const onIssue = useCallback(
    (issue: { tab: string; line: number | null; message: string }) =>
      dispatch({ type: 'issue', issue }),
    [],
  )
  const onLog = useCallback((text: string) => dispatch({ type: 'log', text }), [])
  const onStopped = useCallback(() => dispatch({ type: 'stop' }), [])

  const run = () => {
    if (!resolver) return
    try {
      setPayload(toRunPayload(state.project, resolver))
      dispatch({ type: 'run' })
    } catch (err) {
      dispatch({
        type: 'issue',
        issue: { tab: 'main', line: null, message: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  const pickFromLibrary = (entry: LibraryEntry) => {
    if (picking === 'backdrop') {
      dispatch({ type: 'add-backdrop', ref: refsForEntry(entry) })
    } else {
      dispatch({ type: 'add-sprite', name: entry.label.split(' ')[0], costumes: [refsForEntry(entry)] })
    }
    setPicking(null)
  }

  const uploadAsset = async (file: File) => {
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const natural = await measureImage(dataUrl)
      const size = downscale(natural.width, natural.height)
      // The store learns the dimensions; the ref stays pure identity.
      setStore(prev => new Map(prev).set(dataUrl, { dataUrl, ...size }))
      const ref: AssetRef = { name: file.name.replace(/\.[^.]+$/, ''), source: dataUrl }
      if (picking === 'backdrop') dispatch({ type: 'add-backdrop', ref })
      else dispatch({ type: 'add-sprite', name: ref.name, costumes: [ref] })
      setPicking(null)
    } catch (err) {
      dispatch({
        type: 'issue',
        issue: { tab: 'main', line: null, message: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  const currentScript =
    state.selectedTab === 'main'
      ? state.project.mainScript
      : state.project.sprites.find(s => s.name === state.selectedTab)?.script ?? ''

  const tabs = ['main', ...state.project.sprites.map(s => s.name)]

  return (
    <div className="ide">
      <div className="panel">
        <div className="toolbar">
          <h1>{state.project.name}</h1>
          <button onClick={() => setPicking('backdrop')} disabled={!manifest}>Backdrop</button>
          <button className="primary" onClick={run} disabled={!resolver || state.running}>▶ Run</button>
          <button className="danger" onClick={() => dispatch({ type: 'stop' })} disabled={!state.running}>■ Stop</button>
        </div>
        <StagePanel
          runId={state.runId}
          running={state.running}
          payload={payload}
          onIssue={onIssue}
          onLog={onLog}
          onStopped={onStopped}
        />
        {picking && manifest ? (
          <LibraryDialog
            manifest={manifest}
            store={store}
            kind={picking}
            onPick={pickFromLibrary}
            onUpload={file => void uploadAsset(file)}
            onClose={() => setPicking(null)}
          />
        ) : (
          <SpriteList
            project={state.project}
            selectedTab={state.selectedTab}
            costumeUrl={costumeUrl}
            onSelect={tab => dispatch({ type: 'select-tab', tab })}
            onAdd={() => setPicking('costume')}
            onRename={from => {
              const to = window.prompt(`Rename "${from}" to:`, from)
              if (to && to !== from) dispatch({ type: 'rename-sprite', from, to })
            }}
            onDelete={name => dispatch({ type: 'delete-sprite', name })}
          />
        )}
      </div>

      <div className="panel">
        <div className="toolbar">
          <h1>Code</h1>
          <button onClick={() => setShowApi(v => !v)}>
            {showApi ? 'Hide' : 'Show'} API reference
          </button>
        </div>
        <div className="tabs">
          {tabs.map(tab => (
            <button
              key={tab}
              className={`tab${state.selectedTab === tab ? ' active' : ''}`}
              onClick={() => dispatch({ type: 'select-tab', tab })}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="code-area">
          <div className="code-main">
            <CodeEditor
              tab={state.selectedTab}
              value={currentScript}
              onChange={script => dispatch({ type: 'set-script', tab: state.selectedTab, script })}
            />
            <ConsolePane lines={state.console} />
          </div>
          {showApi && (
            <ApiDrawer
              onInsert={example =>
                dispatch({
                  type: 'set-script',
                  tab: state.selectedTab,
                  script: currentScript === '' ? example : `${currentScript}\n${example}`,
                })
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}
