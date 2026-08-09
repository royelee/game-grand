import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createEmptyProject, toRunPayload, type AssetRef } from '../../shared/project'
import type { RunPayload } from '../../shared/protocol'
import { ApiError, createProject, loadProject, projectUrl, saveProject } from '../api'
import {
  loadManifest, makeResolver, preloadLibrary, refsForEntry,
  type AssetStore, type LibraryEntry, type LibraryManifest,
} from '../library'
import { loadCatalog, type CatalogItem } from '../catalogSearch'
import { ScratchAssetLoader, scratchSource } from '../scratchAssets'
import type { ScratchCatalog } from '../../shared/scratchCatalog'
import { forgetGame, readRecent, rememberGame } from '../recentGames'
import { rehydrateAssetStore } from '../rehydrate'
import { joinTabNames, scriptsReferencing } from '../references'
import { hasUnsavedWork, initialState, reducer } from '../store'
import { measureImage, downscale, readFileAsDataUrl } from '../upload'
import { ApiDrawer } from './ApiDrawer'
import { AssetPanel } from './AssetPanel'
import { CodeEditor } from './CodeEditor'
import { ConsolePane } from './ConsolePane'
import { LibraryDialog } from './LibraryDialog'
import { LoadDialog } from './LoadDialog'
import { SaveBar } from './SaveBar'
import { StagePanel } from './StagePanel'

// Matched once at mount so a route like `/p/<id>` can be opened directly. The
// id is only threaded into state once loading actually succeeds (see the
// effect below) — seeding it eagerly would let a failed load leave `Save`
// pointed at someone else's game.
const startingId = /^\/p\/([A-Za-z0-9_-]{22})$/.exec(window.location.pathname)?.[1] ?? null

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState(createEmptyProject()))
  const [manifest, setManifest] = useState<LibraryManifest | null>(null)
  const [catalog, setCatalog] = useState<ScratchCatalog | null>(null)
  const loader = useMemo(() => new ScratchAssetLoader(), [])
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

  // The reducer already discards a stale `saved`/`save-failed` response via
  // the token (an edit, or a different game opened, bumps it before the
  // response lands), but `handleSave`'s success side effects — rewriting the
  // address bar and remembering the game — happen outside the reducer, so
  // they need their own look at whether the token is still current. A plain
  // read of `state.saveToken` inside the async handler would close over the
  // value from when the save started, which is exactly the stale one; this
  // ref always holds the latest.
  const latestSaveToken = useRef(state.saveToken)
  useEffect(() => {
    latestSaveToken.current = state.saveToken
  }, [state.saveToken])

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
      // The Scratch catalog is a separate, non-fatal load: without it the
      // dialog still offers the built-in ten and Run still works, so a
      // failure here must not block the app the way a manifest failure does.
      try {
        const c = await loadCatalog()
        if (!cancelled) setCatalog(c)
      } catch {
        if (!cancelled) setCatalog(null)
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
        // Uploaded assets carry their bytes in the project itself, but their
        // dimensions only ever lived in this (empty, freshly-mounted) store —
        // without this, Run throws on the first uploaded costume it needs.
        const { additions, issues } = await rehydrateAssetStore(project)
        if (cancelled) return
        if (additions.size > 0) setStore(prev => new Map([...prev, ...additions]))
        dispatch({ type: 'project-loaded', id: startingId, project })
        // project-loaded clears the console, so these must be dispatched after it.
        for (const issue of issues) {
          dispatch({ type: 'issue', issue: { tab: 'main', line: null, message: issue.message } })
        }
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

  // Serves costumes, backdrops and sound previews alike — the store is keyed by
  // asset source regardless of what kind of asset it holds.
  const assetUrl = useCallback(
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

  /**
   * Fetches the bytes before touching the project. The store must already hold
   * every asset a project references — `makeResolver` throws at Run otherwise —
   * so a failed download has to leave the project completely untouched.
   */
  const pickFromScratch = async (item: CatalogItem) => {
    if ('costumes' in item) {
      const assets = [
        ...item.costumes.map(c => ({ md5ext: c.md5ext, res: c.res })),
        ...item.sounds.map(s => ({ md5ext: s.md5ext, res: 1 })),
      ]
      const loaded = await loader.loadMany(assets)
      setStore(prev => new Map([...prev, ...loaded]))
      dispatch({
        type: 'add-sprite',
        name: item.name,
        costumes: item.costumes.map(c => ({ name: c.name, source: scratchSource(c.md5ext) })),
      })
      for (const s of item.sounds) {
        dispatch({ type: 'add-sound', ref: { name: s.name, source: scratchSource(s.md5ext) } })
      }
      setPicking(null)
      return
    }

    const res = 'res' in item ? item.res : 1
    const loaded = await loader.loadMany([{ md5ext: item.md5ext, res }])
    setStore(prev => new Map([...prev, ...loaded]))
    const ref = { name: item.name, source: scratchSource(item.md5ext) }
    if (picking === 'sound') dispatch({ type: 'add-sound', ref })
    else if (picking === 'backdrop') dispatch({ type: 'add-backdrop', ref })
    else dispatch({ type: 'add-sprite', name: item.name, costumes: [ref] })
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

  /**
   * Scripts call backdrops and sounds by name — `playSound("meow")` — and
   * nothing here rewrites code, so renaming or deleting one can quietly break
   * a game. Warn while the kid still remembers what they were doing, rather
   * than letting it surface as an error at Run.
   */
  const confirmNameChange = (name: string, action: 'rename' | 'delete'): boolean => {
    const tabs = scriptsReferencing(state.project, name)
    if (tabs.length === 0) return true
    const consequence =
      action === 'delete'
        ? 'Delete it anyway?'
        : "It won't find it under the new name. Rename it anyway?"
    return window.confirm(`Your code uses "${name}" in ${joinTabNames(tabs)}. ${consequence}`)
  }

  /** Prompt first, then warn: cancelling the prompt costs the kid nothing. */
  const promptRename = (current: string): string | null => {
    const to = window.prompt(`Rename "${current}" to:`, current)
    if (!to || to === current) return null
    return confirmNameChange(current, 'rename') ? to : null
  }

  const backdropHandlers = {
    onAdd: () => setPicking('backdrop'),
    onStartHere: (index: number) => dispatch({ type: 'set-current-backdrop', index }),
    onRename: (index: number) => {
      const to = promptRename(state.project.stage.backdrops[index].name)
      if (to) dispatch({ type: 'rename-backdrop', index, to })
    },
    onDelete: (index: number) => {
      if (confirmNameChange(state.project.stage.backdrops[index].name, 'delete')) {
        dispatch({ type: 'delete-backdrop', index })
      }
    },
  }

  const soundHandlers = {
    onAdd: () => setPicking('sound'),
    onPlay: (source: string) => {
      const url = store.get(source)?.dataUrl
      if (url) void new Audio(url).play().catch(() => {})
    },
    onRename: (index: number) => {
      const to = promptRename(state.project.sounds[index].name)
      if (to) dispatch({ type: 'rename-sound', index, to })
    },
    onDelete: (index: number) => {
      if (confirmNameChange(state.project.sounds[index].name, 'delete')) {
        dispatch({ type: 'delete-sound', index })
      }
    },
  }

  const spriteHandlers = {
    onSelect: (tab: string) => dispatch({ type: 'select-tab', tab }),
    onAdd: () => setPicking('costume'),
    onRename: (from: string) => {
      const to = window.prompt(`Rename "${from}" to:`, from)
      if (to && to !== from) dispatch({ type: 'rename-sprite', from, to })
    },
    onDelete: (name: string) => dispatch({ type: 'delete-sprite', name }),
  }

  const handleSave = async () => {
    const token = state.saveToken
    dispatch({ type: 'saving' })
    try {
      const id = state.projectId
        ? (await saveProject(state.projectId, state.project), state.projectId)
        : await createProject(state.project)
      dispatch({ type: 'saved', id, token })
      // A stale response: something invalidated this save (an edit, or a
      // different game opened) while the request was in flight. Touching the
      // address bar or the recent-games list now would point them at a game
      // that isn't the one on screen — see F3 in the review notes.
      if (token === latestSaveToken.current) {
        if (!state.projectId) window.history.replaceState(null, '', projectUrl(id))
        rememberGame(window.localStorage, {
          id,
          name: state.project.name,
          savedAt: Date.now(),
        })
        setRecent(readRecent(window.localStorage))
      }
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
      // Same rehydration as the /p/<id> mount path — this project may carry
      // uploaded assets this browser session has never seen.
      const { additions, issues } = await rehydrateAssetStore(project)
      if (additions.size > 0) setStore(prev => new Map([...prev, ...additions]))
      dispatch({ type: 'project-loaded', id, project })
      // project-loaded clears the console, so these must be dispatched after it.
      for (const issue of issues) {
        dispatch({ type: 'issue', issue: { tab: 'main', line: null, message: issue.message } })
      }
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
        {/*
          The panel stays mounted and the dialogs overlay it — which is what
          `.panel > .drawer { position: absolute; inset: 0 }` already assumes.
          Keeping it mounted is what lets the kid land back on the tab they
          added from, with the new backdrop or sound visible in the list.
        */}
        <AssetPanel
          project={state.project}
          selectedTab={state.selectedTab}
          assetUrl={assetUrl}
          ready={manifest !== null}
          sprites={spriteHandlers}
          backdrops={backdropHandlers}
          sounds={soundHandlers}
        />
        {picking && manifest ? (
          <LibraryDialog
            manifest={manifest}
            catalog={catalog}
            store={store}
            loader={loader}
            kind={picking}
            onPickLocal={pickFromLibrary}
            onPickScratch={pickFromScratch}
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
        ) : null}
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
