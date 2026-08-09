import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { createEmptyProject, toRunPayload, type AssetRef } from '../../shared/project'
import type { RunPayload } from '../../shared/protocol'
import { ApiError, createProject, loadProject, projectUrl, saveProject } from '../api'
import {
  loadManifest, makeResolver, preloadLibrary, refsForEntry,
  type AssetStore, type LibraryEntry, type LibraryManifest,
} from '../library'
import { forgetGame, readRecent, rememberGame } from '../recentGames'
import { hasUnsavedWork, initialState, reducer } from '../store'
import { measureImage, downscale, readFileAsDataUrl } from '../upload'
import { ApiDrawer } from './ApiDrawer'
import { CodeEditor } from './CodeEditor'
import { ConsolePane } from './ConsolePane'
import { LibraryDialog } from './LibraryDialog'
import { LoadDialog } from './LoadDialog'
import { SaveBar } from './SaveBar'
import { SpriteList } from './SpriteList'
import { StagePanel } from './StagePanel'

// Matched once at mount so a route like `/p/<id>` can be opened directly. The
// id is only threaded into state once loading actually succeeds (see the
// effect below) — seeding it eagerly would let a failed load leave `Save`
// pointed at someone else's game.
const startingId = /^\/p\/([A-Za-z0-9_-]{22})$/.exec(window.location.pathname)?.[1] ?? null

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState(createEmptyProject()))
  const [manifest, setManifest] = useState<LibraryManifest | null>(null)
  const [store, setStore] = useState<AssetStore>(new Map())
  const [payload, setPayload] = useState<RunPayload | null>(null)
  const [picking, setPicking] = useState<'costume' | 'backdrop' | 'sound' | null>(null)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [showApi, setShowApi] = useState(true)
  const [opening, setOpening] = useState(startingId !== null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [loadOpen, setLoadOpen] = useState(false)
  const [recent, setRecent] = useState(() => readRecent(window.localStorage))

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setLibraryError(null)
        const m = await loadManifest()
        const loaded = await preloadLibrary(m)
        if (cancelled) return
        setManifest(m)
        setStore(prev => new Map([...prev, ...loaded]))
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setLibraryError(message)
        dispatch({ type: 'issue', issue: { tab: 'main', line: null, message } })
      }
    })()
    return () => { cancelled = true }
  }, [loadAttempt])

  useEffect(() => {
    if (!startingId) return
    let cancelled = false
    void (async () => {
      try {
        const project = await loadProject(startingId)
        if (cancelled) return
        dispatch({ type: 'project-loaded', id: startingId, project })
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof ApiError ? err.message : 'Something went wrong opening your game.'
        dispatch({ type: 'issue', issue: { tab: 'main', line: null, message } })
        setOpenError(message)
      } finally {
        if (!cancelled) setOpening(false)
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
    if (picking === 'sound') {
      dispatch({ type: 'add-sound', ref: refsForEntry(entry) })
    } else if (picking === 'backdrop') {
      dispatch({ type: 'add-backdrop', ref: refsForEntry(entry) })
    } else {
      dispatch({ type: 'add-sprite', name: entry.label.split(' ')[0], costumes: [refsForEntry(entry)] })
    }
    setPicking(null)
  }

  const uploadAsset = async (file: File) => {
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const ref: AssetRef = { name: file.name.replace(/\.[^.]+$/, ''), source: dataUrl }
      if (picking === 'sound') {
        // A sound never decodes as an <Image>; only costumes/backdrops need
        // measuring for collision boxes and downscaling.
        setStore(prev => new Map(prev).set(dataUrl, { dataUrl, width: 0, height: 0 }))
        dispatch({ type: 'add-sound', ref })
      } else {
        const natural = await measureImage(dataUrl)
        const size = downscale(natural.width, natural.height)
        // The store learns the dimensions; the ref stays pure identity.
        setStore(prev => new Map(prev).set(dataUrl, { dataUrl, ...size }))
        if (picking === 'backdrop') dispatch({ type: 'add-backdrop', ref })
        else dispatch({ type: 'add-sprite', name: ref.name, costumes: [ref] })
      }
      setPicking(null)
    } catch (err) {
      dispatch({
        type: 'issue',
        issue: { tab: 'main', line: null, message: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  const handleSave = async () => {
    const token = state.saveToken
    dispatch({ type: 'saving' })
    try {
      const id = state.projectId
        ? (await saveProject(state.projectId, state.project), state.projectId)
        : await createProject(state.project)
      dispatch({ type: 'saved', id, token })
      if (!state.projectId) window.history.replaceState(null, '', projectUrl(id))
      rememberGame(window.localStorage, {
        id,
        name: state.project.name,
        savedAt: Date.now(),
      })
      setRecent(readRecent(window.localStorage))
    } catch (err) {
      dispatch({
        type: 'save-failed',
        message: err instanceof ApiError ? err.message : 'Something went wrong saving your game.',
        token,
      })
    }
  }

  const handleOpen = async (id: string) => {
    // Loading a project replaces the whole in-memory project with no merge —
    // if the current one isn't safely on the server yet, confirm first so a
    // kid can't lose work by tapping "Open" on something in the drawer.
    if (
      hasUnsavedWork(state) &&
      !window.confirm("Your changes aren't saved yet. Open another game anyway?")
    ) {
      return
    }
    const token = state.saveToken
    try {
      const project = await loadProject(id)
      dispatch({ type: 'project-loaded', id, project })
      window.history.pushState(null, '', projectUrl(id))
      setLoadOpen(false)
    } catch (err) {
      dispatch({
        type: 'save-failed',
        message: err instanceof ApiError ? err.message : 'Something went wrong opening that game.',
        token,
      })
    }
  }

  const handleForget = (id: string) => {
    forgetGame(window.localStorage, id)
    setRecent(readRecent(window.localStorage))
  }

  const currentScript =
    state.selectedTab === 'main'
      ? state.project.mainScript
      : state.project.sprites.find(s => s.name === state.selectedTab)?.script ?? ''

  const tabs = ['main', ...state.project.sprites.map(s => s.name)]

  if (opening) {
    return (
      <div className="ide-opening">
        <p>Opening your game…</p>
      </div>
    )
  }

  return (
    <div className="ide">
      <div className="panel">
        <SaveBar
          state={state}
          onRename={name => dispatch({ type: 'rename-project', name })}
          onSave={() => void handleSave()}
          onOpenLoad={() => setLoadOpen(true)}
        />
        {openError && (
          <div className="banner">
            <span>{openError}</span>
            <button onClick={() => setOpenError(null)}>Start a new game instead</button>
          </div>
        )}
        <div className="toolbar">
          <h1>{state.project.name}</h1>
          <button onClick={() => setPicking('backdrop')} disabled={!manifest}>Backdrop</button>
          <button onClick={() => setPicking('sound')} disabled={!manifest}>Sounds</button>
          <button className="primary" onClick={run} disabled={!resolver || state.running}>▶ Run</button>
          <button className="danger" onClick={() => dispatch({ type: 'stop' })} disabled={!state.running}>■ Stop</button>
        </div>
        {libraryError && (
          <div className="banner">
            <span>The sprite library didn’t load, so you can’t add sprites yet.</span>
            <button onClick={() => setLoadAttempt(n => n + 1)}>Try again</button>
          </div>
        )}
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
        ) : loadOpen ? (
          <LoadDialog
            recent={recent}
            onOpen={id => void handleOpen(id)}
            onForget={handleForget}
            onClose={() => setLoadOpen(false)}
          />
        ) : (
          <SpriteList
            project={state.project}
            selectedTab={state.selectedTab}
            costumeUrl={costumeUrl}
            onSelect={tab => dispatch({ type: 'select-tab', tab })}
            onAdd={() => manifest && setPicking('costume')}
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
