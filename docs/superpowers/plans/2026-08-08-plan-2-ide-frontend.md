# IDE Frontend Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the headless engine from Plan 1 into a usable playground — a React IDE with a live Phaser stage on the left and a Monaco editor on the right, plus the sprite list, asset library, API reference drawer, and console.

**Architecture:** User code never runs in the IDE's page. Pressing Run mounts a sandboxed `<iframe src="/runtime.html">`; the parent posts a fully-resolved run payload into it; inside, a session builds a `World` + `Executor` (Plan 1), a Phaser scene drives `world.tick(dt)` each frame and renders `world.snapshot()`, and issues/logs come back by `postMessage`. Stop unmounts the iframe — which is also how "one fresh World + Executor per run" is guaranteed.

**Tech Stack:** React 18, TypeScript, Vite (two HTML entries), Phaser 3, Monaco (bundled, no CDN), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-08-game-playground-design.md`
**Builds on:** Plan 1, merged to `main` — `src/runtime/*` and `src/shared/apiDefs.ts`. Plan 3 adds the save server; this plan keeps projects in memory only (no persistence UI beyond what Plan 3 will wire).

## Global Constraints

- **Never run user code in the parent page.** All script execution happens inside the sandboxed iframe. The parent never calls `eval`, `new Function`, or imports `src/runtime/executor`.
- **One run = one fresh iframe.** Run mounts a new iframe (new React `key`); Stop unmounts it. Never call `Executor.run()` twice against one `World` (documented in `docs/TODO.md`).
- **Renderers reconcile sprites by the snapshot's `id`**, never by `name` (clones share names) and never by array index (layer order mutates). Array order in `snapshot().sprites` IS layer order, last = frontmost.
- **All assets cross the iframe boundary as `data:` URLs.** The iframe is an opaque origin (`sandbox="allow-scripts"`); URL-loaded textures would taint WebGL. The parent resolves `library:<id>` refs to data URLs before posting.
- Stage is 480×360 logical. Scratch→Phaser mapping: `px = 240 + x`, `py = 180 - y`, `angle = direction - 90`.
- Monaco is bundled from npm and its workers come from Vite `?worker` imports — no CDN loader, no network at runtime.
- Logic lives in pure modules with unit tests; React components stay thin enough not to need a DOM test environment. Do not add jsdom or @testing-library.
- TDD every task: failing test → implement → pass → commit. One commit per task minimum.
- `src/runtime/**` stays untouched by this plan. If you believe an engine change is required, stop and report it rather than editing Plan 1 code.

## File Structure

```
vite.config.ts                     # + second entry (runtime.html), monaco workers  (Task 1)
runtime.html                       # iframe document                                 (Task 1)
src/shared/protocol.ts             # postMessage message types + type guards         (Task 1)
src/shared/project.ts              # Project model, toRunPayload, validation         (Task 2)
src/ide/bridge.ts                  # RuntimeBridge: parent side of the protocol      (Task 1)
src/ide/library.ts                 # library manifest loading + asset resolution     (Task 3)
src/ide/store.ts                   # pure reducer for IDE state                      (Task 6)
src/ide/completions.ts             # Monaco completion items from API_DEFS           (Task 7)
src/ide/reference.ts               # grouping/search for the API drawer              (Task 8)
src/ide/components/*.tsx           # App, StagePanel, SpriteList, CodePanel, …       (Tasks 6-9)
src/runtime-host/session.ts        # payload → World + Executor + step(dt)           (Task 4)
src/runtime-host/keys.ts           # browser key → kid-friendly key name             (Task 4)
src/runtime-host/spriteViews.ts    # snapshot → view ops reconciliation (pure)       (Task 5)
src/runtime-host/scene.ts          # Phaser scene applying view ops                  (Task 5)
src/runtime-host/main.ts           # iframe entry: wires session+scene+input+bridge   (Task 5)
public/library/…                   # starter costumes/backdrops + library.json       (Task 3)
scripts/fetch-scratch-library.mjs  # optional Scratch CDN bootstrap                  (Task 3)
```

Tests are colocated (`foo.test.ts`), except `public/` and `scripts/`.

---

### Task 1: Two-entry build, protocol, and the parent-side bridge

**Files:**
- Modify: `vite.config.ts`, `package.json`
- Create: `runtime.html`, `src/runtime-host/main.ts` (stub), `src/shared/protocol.ts`, `src/ide/bridge.ts`
- Test: `src/shared/protocol.test.ts`, `src/ide/bridge.test.ts`

**Interfaces:**
- Consumes: `ScriptIssue` from `src/runtime/executor` (type-only import — allowed in the parent; only the *executor implementation* is forbidden there).
- Produces: `LoadedCostume`, `RunPayload`, `HostMessage`, `IdeMessage`, guards `isHostMessage`/`isIdeMessage`; `class RuntimeBridge` with `constructor(target: { postMessage(msg: unknown, origin: string): void }, handlers: BridgeHandlers)`, `handleMessage(data: unknown): void`, `run(payload: RunPayload): void`, `dispose(): void`. Tasks 4-5 consume the message types; Task 9 wires the bridge.

- [ ] **Step 1: Add dependencies**

Run: `npm install phaser@^3.80.1 monaco-editor@^0.52.0 @monaco-editor/react@^4.6.0`
Expected: installs cleanly; `package.json` gains the three dependencies.

- [ ] **Step 2: Write the failing tests**

`src/shared/protocol.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isHostMessage, isIdeMessage } from './protocol'

describe('protocol guards', () => {
  it('accepts well-formed host messages', () => {
    expect(isHostMessage({ type: 'ready' })).toBe(true)
    expect(isHostMessage({ type: 'log', text: 'hi' })).toBe(true)
    expect(isHostMessage({ type: 'issue', issue: { tab: 'Cat', line: 2, message: 'boom' } })).toBe(true)
    expect(isHostMessage({ type: 'stopped' })).toBe(true)
  })

  it('rejects junk, foreign postMessage noise, and wrong shapes', () => {
    expect(isHostMessage(null)).toBe(false)
    expect(isHostMessage('ready')).toBe(false)
    expect(isHostMessage({ type: 'unknown' })).toBe(false)
    expect(isHostMessage({ type: 'log' })).toBe(false)
    expect(isHostMessage({ type: 'issue', issue: { tab: 'Cat' } })).toBe(false)
    expect(isHostMessage({ source: 'react-devtools-bridge' })).toBe(false)
  })

  it('recognizes ide messages', () => {
    expect(isIdeMessage({ type: 'run', payload: { sprites: [], backdrops: [], currentBackdrop: 0, sounds: [], mainScript: '' } })).toBe(true)
    expect(isIdeMessage({ type: 'run' })).toBe(false)
  })
})
```

`src/ide/bridge.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { RuntimeBridge } from './bridge'
import type { RunPayload } from '../shared/protocol'

const payload: RunPayload = {
  sprites: [], backdrops: [], currentBackdrop: 0, sounds: [], mainScript: '',
}

function setup() {
  const posted: unknown[] = []
  const target = { postMessage: (m: unknown) => posted.push(m) }
  const onIssue = vi.fn()
  const onLog = vi.fn()
  const onStopped = vi.fn()
  const bridge = new RuntimeBridge(target, { onIssue, onLog, onStopped })
  return { bridge, posted, onIssue, onLog, onStopped }
}

describe('RuntimeBridge', () => {
  it('queues run() until the host says ready, then flushes once', () => {
    const { bridge, posted } = setup()
    bridge.run(payload)
    expect(posted).toEqual([])
    bridge.handleMessage({ type: 'ready' })
    expect(posted).toEqual([{ type: 'run', payload }])
    bridge.handleMessage({ type: 'ready' })
    expect(posted).toHaveLength(1)
  })

  it('sends immediately when run() comes after ready', () => {
    const { bridge, posted } = setup()
    bridge.handleMessage({ type: 'ready' })
    bridge.run(payload)
    expect(posted).toEqual([{ type: 'run', payload }])
  })

  it('routes issues, logs, and stopped to handlers', () => {
    const { bridge, onIssue, onLog, onStopped } = setup()
    const issue = { tab: 'Cat', line: 3, message: 'boom' }
    bridge.handleMessage({ type: 'issue', issue })
    bridge.handleMessage({ type: 'log', text: 'hello' })
    bridge.handleMessage({ type: 'stopped' })
    expect(onIssue).toHaveBeenCalledWith(issue)
    expect(onLog).toHaveBeenCalledWith('hello')
    expect(onStopped).toHaveBeenCalledOnce()
  })

  it('ignores foreign messages without throwing', () => {
    const { bridge, onLog } = setup()
    bridge.handleMessage({ source: 'react-devtools-bridge' })
    bridge.handleMessage(undefined)
    expect(onLog).not.toHaveBeenCalled()
  })

  it('drops messages after dispose', () => {
    const { bridge, posted, onLog } = setup()
    bridge.dispose()
    bridge.handleMessage({ type: 'ready' })
    bridge.run(payload)
    bridge.handleMessage({ type: 'log', text: 'x' })
    expect(posted).toEqual([])
    expect(onLog).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/shared/protocol.test.ts src/ide/bridge.test.ts`
Expected: FAIL — cannot resolve `./protocol` / `./bridge`.

- [ ] **Step 4: Write the implementations**

`src/shared/protocol.ts`:
```ts
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
```

`src/ide/bridge.ts`:
```ts
import { isHostMessage, type RunPayload } from '../shared/protocol'
import type { ScriptIssue } from '../runtime/executor'

export interface BridgeHandlers {
  onIssue: (issue: ScriptIssue) => void
  onLog: (text: string) => void
  onStopped: () => void
}

export interface PostTarget {
  postMessage(message: unknown, targetOrigin: string): void
}

/**
 * Parent side of the iframe protocol. Holds a run payload until the host
 * reports `ready`, because the iframe's scripts may not have parsed yet when
 * the user hits Run.
 */
export class RuntimeBridge {
  private ready = false
  private pending: RunPayload | null = null
  private disposed = false

  constructor(
    private target: PostTarget,
    private handlers: BridgeHandlers,
  ) {}

  run(payload: RunPayload): void {
    if (this.disposed) return
    if (this.ready) this.send(payload)
    else this.pending = payload
  }

  handleMessage(data: unknown): void {
    if (this.disposed || !isHostMessage(data)) return
    switch (data.type) {
      case 'ready':
        if (this.ready) return
        this.ready = true
        if (this.pending) {
          const p = this.pending
          this.pending = null
          this.send(p)
        }
        return
      case 'issue':
        return this.handlers.onIssue(data.issue)
      case 'log':
        return this.handlers.onLog(data.text)
      case 'stopped':
        return this.handlers.onStopped()
    }
  }

  dispose(): void {
    this.disposed = true
    this.pending = null
  }

  private send(payload: RunPayload): void {
    // targetOrigin '*': the sandboxed iframe has an opaque origin, so no
    // specific origin can be named. Nothing secret travels this direction.
    this.target.postMessage({ type: 'run', payload }, '*')
  }
}
```

`runtime.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Game Stage</title>
    <style>
      html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <div id="stage"></div>
    <script type="module" src="/src/runtime-host/main.ts"></script>
  </body>
</html>
```

`src/runtime-host/main.ts` (stub — Task 5 replaces the body):
```ts
import { isIdeMessage } from '../shared/protocol'

window.addEventListener('message', event => {
  if (!isIdeMessage(event.data)) return
  // Task 5 wires the session and renderer here.
})

parent.postMessage({ type: 'ready' }, '*')
```

`vite.config.ts` (replace the file):
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        runtime: resolve(__dirname, 'runtime.html'),
      },
    },
  },
  test: { environment: 'node' },
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/shared/protocol.test.ts src/ide/bridge.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify the two-entry build**

Run: `npm test && npm run build`
Expected: all tests pass; build emits both `dist/index.html` and `dist/runtime.html`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: two-entry build, iframe protocol, and parent-side runtime bridge"
```

---

### Task 2: Project model and run-payload assembly

**Files:**
- Create: `src/shared/project.ts`
- Test: `src/shared/project.test.ts`

**Interfaces:**
- Consumes: `RunPayload`, `LoadedCostume` (Task 1).
- Produces: `AssetRef { name: string; source: string }`, `SpriteDef`, `StageDef`, `Project` (with `version: 1`), `createEmptyProject(): Project`, `addSprite(project, name, costumes): Project`, `renameSprite(project, from, to): Project`, `deleteSprite(project, name): Project`, `setScript(project, tab, script): Project` (tab `'main'` or a sprite name), `uniqueSpriteName(project, desired): string`, `addBackdrop(project, ref): Project` (appends and selects it; re-selects an existing backdrop with the same source instead of duplicating), `toRunPayload(project, resolve): RunPayload` where `resolve: (ref: AssetRef) => LoadedCostume`. All functions are pure and return new objects. Tasks 3, 6 and 9 consume these.

- [ ] **Step 1: Write the failing test**

`src/shared/project.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  createEmptyProject, addSprite, renameSprite, deleteSprite, setScript,
  uniqueSpriteName, addBackdrop, toRunPayload, type AssetRef, type Project,
} from './project'
import type { LoadedCostume } from './protocol'

const catCostume: AssetRef = { name: 'cat-a', source: 'library:cat-a' }
const resolve = (ref: AssetRef): LoadedCostume => ({
  name: ref.name, width: 40, height: 40, dataUrl: `data:image/svg+xml,${ref.name}`,
})

function withCat(): Project {
  return addSprite(createEmptyProject(), 'Cat', [catCostume])
}

describe('project model', () => {
  it('starts with a stage, no sprites, and an empty main script', () => {
    const p = createEmptyProject()
    expect(p.version).toBe(1)
    expect(p.sprites).toEqual([])
    expect(p.stage.backdrops.length).toBeGreaterThan(0)
    expect(p.mainScript).toBe('')
  })

  it('adds sprites with Scratch defaults and never mutates the input', () => {
    const before = createEmptyProject()
    const after = addSprite(before, 'Cat', [catCostume])
    expect(before.sprites).toEqual([])
    expect(after.sprites[0]).toMatchObject({
      name: 'Cat', x: 0, y: 0, size: 100, direction: 90, visible: true,
      currentCostume: 0, script: '',
    })
  })

  it('makes duplicate names unique', () => {
    let p = withCat()
    expect(uniqueSpriteName(p, 'Cat')).toBe('Cat2')
    p = addSprite(p, uniqueSpriteName(p, 'Cat'), [catCostume])
    expect(uniqueSpriteName(p, 'Cat')).toBe('Cat3')
    expect(uniqueSpriteName(p, 'Bat')).toBe('Bat')
  })

  it('renames a sprite and deletes by name', () => {
    let p = setScript(withCat(), 'Cat', 'onStart(() => {})')
    p = renameSprite(p, 'Cat', 'Kitty')
    expect(p.sprites[0].name).toBe('Kitty')
    expect(p.sprites[0].script).toBe('onStart(() => {})')
    p = deleteSprite(p, 'Kitty')
    expect(p.sprites).toEqual([])
  })

  it('rejects renaming onto an existing name', () => {
    const p = addSprite(withCat(), 'Bat', [catCostume])
    expect(() => renameSprite(p, 'Bat', 'Cat')).toThrow(/already/)
  })

  it('sets the main script and per-sprite scripts by tab', () => {
    let p = withCat()
    p = setScript(p, 'main', 'vars.score = 0')
    p = setScript(p, 'Cat', 'onStart(() => {})')
    expect(p.mainScript).toBe('vars.score = 0')
    expect(p.sprites[0].script).toBe('onStart(() => {})')
  })

  it('adds a backdrop and selects it, without duplicating a known source', () => {
    const night: AssetRef = { name: 'night', source: 'library:night' }
    let p = addBackdrop(createEmptyProject(), night)
    expect(p.stage.backdrops.map(b => b.name)).toEqual(['blue-sky', 'night'])
    expect(p.stage.currentBackdrop).toBe(1)
    p = addBackdrop(p, { name: 'blue-sky', source: 'library:blue-sky' })
    expect(p.stage.backdrops).toHaveLength(2)
    expect(p.stage.currentBackdrop).toBe(0)
  })

  it('builds a run payload with every asset resolved', () => {
    const p = setScript(withCat(), 'main', 'vars.score = 0')
    const payload = toRunPayload(p, resolve)
    expect(payload.mainScript).toBe('vars.score = 0')
    expect(payload.sprites).toHaveLength(1)
    expect(payload.sprites[0].costumes[0]).toEqual({
      name: 'cat-a', width: 40, height: 40, dataUrl: 'data:image/svg+xml,cat-a',
    })
    expect(payload.backdrops[0].dataUrl).toContain('data:')
    expect(payload.sprites[0].script).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/project.test.ts`
Expected: FAIL — cannot resolve `./project`.

- [ ] **Step 3: Write the implementation**

`src/shared/project.ts`:
```ts
import type { LoadedCostume, RunPayload } from './protocol'

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
  const taken = new Set(project.sprites.map(s => s.name))
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/project.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/project.ts src/shared/project.test.ts
git commit -m "feat: project model and run-payload assembly"
```

---

### Task 3: Asset library — manifest, resolver, starter set

**Files:**
- Create: `src/ide/library.ts`, `public/library/library.json`, `public/library/*.svg` (7 files below), `public/library/LICENSE.md`, `scripts/fetch-scratch-library.mjs`
- Test: `src/ide/library.test.ts`

**Interfaces:**
- Consumes: `AssetRef` (Task 2), `LoadedCostume` (Task 1).
- Produces: `LibraryEntry { id: string; kind: 'costume' | 'backdrop' | 'sound'; label: string; file: string; width: number; height: number }`, `LibraryManifest { entries: LibraryEntry[] }`, `LoadedAsset { dataUrl: string; width: number; height: number }`, `AssetStore = Map<string, LoadedAsset>` **keyed by `AssetRef.source`**, `makeResolver(store: AssetStore): (ref: AssetRef) => LoadedCostume`, `libraryRefId(source): string | null`, `refsForEntry(entry): AssetRef`, `loadManifest(fetchFn): Promise<LibraryManifest>`, `fetchAsDataUrl(url, fetchFn): Promise<string>`, `preloadLibrary(manifest, fetchFn, toDataUrl): Promise<AssetStore>`. Task 6 preloads once at startup; Task 9 adds uploaded assets to the same store and passes the resolver to `toRunPayload`.

**Why a store instead of dimensions on the ref:** Scratch's own catalogs
(`scratch-gui/src/lib/libraries/*.json`) give a costume an `assetId`,
`md5ext`, `dataFormat`, `bitmapResolution`, and rotation centre — and no
width or height. Scratch decodes the asset to learn its size. Copy that
separation: **an `AssetRef` identifies an asset; the store describes it.**
A width cached on a ref can disagree with the file it points at; one that
lives beside the loaded bytes cannot. This also keeps saved projects small
and stable for Plan 3. Everything is in the store before Run, so the
resolver stays synchronous.

The resolver is split from the fetching deliberately: resolution is pure and unit-tested; fetching is one thin adapter.

- [ ] **Step 1: Write the failing test**

`src/ide/library.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  libraryRefId, makeResolver, refsForEntry, loadManifest, preloadLibrary,
  type AssetStore, type LibraryManifest,
} from './library'

const manifest: LibraryManifest = {
  entries: [
    { id: 'cat-a', kind: 'costume', label: 'Cat', file: 'cat-a.svg', width: 60, height: 60 },
    { id: 'blue-sky', kind: 'backdrop', label: 'Blue sky', file: 'blue-sky.svg', width: 480, height: 360 },
  ],
}
const store: AssetStore = new Map([
  ['library:cat-a', { dataUrl: 'data:image/svg+xml;base64,AAA', width: 60, height: 60 }],
  ['library:blue-sky', { dataUrl: 'data:image/svg+xml;base64,BBB', width: 480, height: 360 }],
])

describe('library refs', () => {
  it('extracts library ids and ignores other sources', () => {
    expect(libraryRefId('library:cat-a')).toBe('cat-a')
    expect(libraryRefId('data:image/png;base64,xyz')).toBeNull()
  })

  it('builds an AssetRef from an entry', () => {
    expect(refsForEntry(manifest.entries[0])).toEqual({ name: 'cat-a', source: 'library:cat-a' })
  })
})

describe('resolver', () => {
  it('resolves library refs to dimensions and data urls', () => {
    const resolve = makeResolver(store)
    expect(resolve({ name: 'cat-a', source: 'library:cat-a' })).toEqual({
      name: 'cat-a', width: 60, height: 60, dataUrl: 'data:image/svg+xml;base64,AAA',
    })
  })

  it('resolves uploaded refs from the same store, keyed by their data url', () => {
    const withUpload: AssetStore = new Map(store)
    withUpload.set('data:image/png;base64,zzz', {
      dataUrl: 'data:image/png;base64,zzz', width: 32, height: 48,
    })
    expect(makeResolver(withUpload)({ name: 'me', source: 'data:image/png;base64,zzz' })).toEqual({
      name: 'me', width: 32, height: 48, dataUrl: 'data:image/png;base64,zzz',
    })
  })

  it('keeps the ref name, not the library id, so renamed costumes still work', () => {
    const resolve = makeResolver(store)
    expect(resolve({ name: 'my-cat', source: 'library:cat-a' }).name).toBe('my-cat')
  })

  it('throws a clear error for an asset that was never loaded', () => {
    const resolve = makeResolver(store)
    expect(() => resolve({ name: 'x', source: 'library:nope' })).toThrow(/library:nope/)
  })
})

describe('loading', () => {
  it('loads the manifest as json', async () => {
    const fetchFn = async () => ({ ok: true, json: async () => manifest }) as unknown as Response
    expect(await loadManifest(fetchFn)).toEqual(manifest)
  })

  it('rejects a failed manifest fetch', async () => {
    const fetchFn = async () => ({ ok: false, status: 404 }) as unknown as Response
    await expect(loadManifest(fetchFn)).rejects.toThrow(/404/)
  })

  it('preloads every entry into a store keyed by ref source, carrying dimensions', async () => {
    const fetchFn = async (url: string) => ({
      ok: true,
      blob: async () => url,
    }) as unknown as Response
    const toDataUrl = async (blob: unknown) => `data:fake,${String(blob)}`
    const loaded = await preloadLibrary(manifest, fetchFn, toDataUrl)
    expect(loaded.get('library:cat-a')).toEqual({
      dataUrl: 'data:fake,/library/cat-a.svg', width: 60, height: 60,
    })
    expect(loaded.size).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ide/library.test.ts`
Expected: FAIL — cannot resolve `./library`.

- [ ] **Step 3: Write the implementation**

`src/ide/library.ts`:
```ts
import type { LoadedCostume } from '../shared/protocol'
import type { AssetRef } from '../shared/project'

export interface LibraryEntry {
  id: string
  kind: 'costume' | 'backdrop' | 'sound'
  label: string
  file: string
  width: number
  height: number
}

export interface LibraryManifest {
  entries: LibraryEntry[]
}

/** A decoded asset: the bytes plus the size we measured. */
export interface LoadedAsset {
  dataUrl: string
  width: number
  height: number
}

/**
 * Every asset the app has loaded, keyed by `AssetRef.source`
 * (`library:<id>` or the upload's own data URL).
 *
 * Dimensions live here rather than on the AssetRef, following Scratch's own
 * catalogs: a reference identifies an asset, the loaded asset describes it.
 * See docs/sprite_libraries.md.
 */
export type AssetStore = Map<string, LoadedAsset>

export const LIBRARY_BASE = '/library'

export function libraryRefId(source: string): string | null {
  return source.startsWith('library:') ? source.slice('library:'.length) : null
}

export function refsForEntry(entry: LibraryEntry): AssetRef {
  return { name: entry.id, source: `library:${entry.id}` }
}

/**
 * Turns AssetRefs into fully-loaded costumes by looking each ref's source up
 * in the store. Library assets land there during preload; uploads land there
 * when the user adds them. Anything not in the store is a bug in the caller,
 * not a user error — every asset is loaded before a run starts.
 */
export function makeResolver(store: AssetStore): (ref: AssetRef) => LoadedCostume {
  return (ref: AssetRef): LoadedCostume => {
    const asset = store.get(ref.source)
    if (!asset) {
      throw new Error(`Asset "${ref.source}" has not been loaded.`)
    }
    return {
      name: ref.name,
      width: asset.width,
      height: asset.height,
      dataUrl: asset.dataUrl,
    }
  }
}

export async function loadManifest(
  fetchFn: (url: string) => Promise<Response> = fetch,
): Promise<LibraryManifest> {
  const res = await fetchFn(`${LIBRARY_BASE}/library.json`)
  if (!res.ok) throw new Error(`Could not load the asset library (HTTP ${res.status}).`)
  return (await res.json()) as LibraryManifest
}

export async function fetchAsDataUrl(
  url: string,
  fetchFn: (url: string) => Promise<Response> = fetch,
  toDataUrl: (blob: Blob) => Promise<string> = blobToDataUrl,
): Promise<string> {
  const res = await fetchFn(url)
  if (!res.ok) throw new Error(`Could not load asset ${url} (HTTP ${res.status}).`)
  return toDataUrl(await res.blob())
}

export async function preloadLibrary(
  manifest: LibraryManifest,
  fetchFn: (url: string) => Promise<Response> = fetch,
  toDataUrl: (blob: Blob) => Promise<string> = blobToDataUrl,
): Promise<AssetStore> {
  const pairs = await Promise.all(
    manifest.entries.map(async e => {
      const dataUrl = await fetchAsDataUrl(`${LIBRARY_BASE}/${e.file}`, fetchFn, toDataUrl)
      return [`library:${e.id}`, { dataUrl, width: e.width, height: e.height }] as const
    }),
  )
  return new Map(pairs)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
```

- [ ] **Step 4: Create the starter assets**

These ship with the app so it runs with zero downloads. Write each file exactly.

`public/library/cat-a.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><ellipse cx="30" cy="38" rx="20" ry="15" fill="#f4a63c"/><circle cx="30" cy="20" r="14" fill="#f9bc60"/><polygon points="18,10 22,20 14,18" fill="#f4a63c"/><polygon points="42,10 38,20 46,18" fill="#f4a63c"/><circle cx="25" cy="19" r="2.5" fill="#2b2b2b"/><circle cx="35" cy="19" r="2.5" fill="#2b2b2b"/><path d="M27 25 Q30 28 33 25" stroke="#2b2b2b" stroke-width="1.5" fill="none"/></svg>
```

`public/library/cat-b.svg` (same cat, legs shifted — the walk frame):
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><ellipse cx="30" cy="38" rx="22" ry="14" fill="#f4a63c"/><circle cx="30" cy="20" r="14" fill="#f9bc60"/><polygon points="18,10 22,20 14,18" fill="#f4a63c"/><polygon points="42,10 38,20 46,18" fill="#f4a63c"/><circle cx="25" cy="19" r="2.5" fill="#2b2b2b"/><circle cx="35" cy="19" r="2.5" fill="#2b2b2b"/><path d="M27 26 Q30 23 33 26" stroke="#2b2b2b" stroke-width="1.5" fill="none"/></svg>
```

`public/library/ball.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#e04b4b"/><circle cx="14" cy="14" r="5" fill="#ffffff" opacity="0.6"/></svg>
```

`public/library/bat.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40" viewBox="0 0 60 40"><ellipse cx="30" cy="22" rx="9" ry="11" fill="#5b4b8a"/><path d="M21 18 Q6 6 2 22 Q10 20 21 26 Z" fill="#6f5da8"/><path d="M39 18 Q54 6 58 22 Q50 20 39 26 Z" fill="#6f5da8"/><circle cx="26" cy="18" r="2" fill="#fff"/><circle cx="34" cy="18" r="2" fill="#fff"/></svg>
```

`public/library/star.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><polygon points="20,2 25,15 39,15 28,23 32,37 20,29 8,37 12,23 1,15 15,15" fill="#f5c518"/></svg>
```

`public/library/blue-sky.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#9fd8f6"/><rect y="300" width="480" height="60" fill="#7ec850"/><circle cx="400" cy="60" r="30" fill="#ffe066"/></svg>
```

`public/library/night.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#1b2452"/><circle cx="90" cy="70" r="26" fill="#f4f1c9"/><circle cx="200" cy="50" r="2" fill="#fff"/><circle cx="320" cy="90" r="2" fill="#fff"/><circle cx="410" cy="40" r="2" fill="#fff"/><circle cx="150" cy="140" r="2" fill="#fff"/><rect y="310" width="480" height="50" fill="#12183a"/></svg>
```

`public/library/library.json`:
```json
{
  "entries": [
    { "id": "cat-a", "kind": "costume", "label": "Cat", "file": "cat-a.svg", "width": 60, "height": 60 },
    { "id": "cat-b", "kind": "costume", "label": "Cat walking", "file": "cat-b.svg", "width": 60, "height": 60 },
    { "id": "ball", "kind": "costume", "label": "Ball", "file": "ball.svg", "width": 40, "height": 40 },
    { "id": "bat", "kind": "costume", "label": "Bat", "file": "bat.svg", "width": 60, "height": 40 },
    { "id": "star", "kind": "costume", "label": "Star", "file": "star.svg", "width": 40, "height": 40 },
    { "id": "blue-sky", "kind": "backdrop", "label": "Blue sky", "file": "blue-sky.svg", "width": 480, "height": 360 },
    { "id": "night", "kind": "backdrop", "label": "Night", "file": "night.svg", "width": 480, "height": 360 }
  ]
}
```

`public/library/LICENSE.md`:
```markdown
# Library assets

The starter assets in this directory (`cat-a`, `cat-b`, `ball`, `bat`, `star`,
`blue-sky`, `night`) were authored for this project and carry the project's
own license.

Assets added by `scripts/fetch-scratch-library.mjs` come from the Scratch
project's media library and are licensed **CC BY-SA 4.0**
(https://creativecommons.org/licenses/by-sa/4.0/). If you run that script and
ship the results, you must keep this notice, credit the Scratch project in the
app's library dialog, and keep those asset files under CC BY-SA 4.0.
See `docs/sprite_libraries.md`.
```

- [ ] **Step 5: Write the optional Scratch bootstrap script**

`scripts/fetch-scratch-library.mjs`:
```js
#!/usr/bin/env node
// Optional: enrich public/library/ with assets from the Scratch media library.
// Scratch library media is CC BY-SA 4.0 — see public/library/LICENSE.md and
// docs/sprite_libraries.md before shipping what this downloads.
//
// Usage: node scripts/fetch-scratch-library.mjs <md5ext> <id> <kind> <label>
//   e.g. node scripts/fetch-scratch-library.mjs b7853f557e4426412e64bb3da6531a99.svg scratch-cat costume "Scratch Cat"
// Appends the entry to library.json (dimensions are read from the SVG header,
// or pass --width/--height for bitmaps).

import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const libDir = resolve(root, 'public/library')
const CDN = 'https://assets.scratch.mit.edu/internalapi/asset'

const [md5ext, id, kind, label] = process.argv.slice(2)
if (!md5ext || !id || !kind || !label) {
  console.error('usage: fetch-scratch-library.mjs <md5ext> <id> <kind> <label> [--width N --height N]')
  process.exit(1)
}

const flag = name => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : Number(process.argv[i + 1])
}

const res = await fetch(`${CDN}/${md5ext}/get/`)
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`)
  process.exit(1)
}
const bytes = Buffer.from(await res.arrayBuffer())
const file = `${id}${md5ext.slice(md5ext.lastIndexOf('.'))}`
await writeFile(resolve(libDir, file), bytes)

let width = flag('width')
let height = flag('height')
if (width === null || height === null) {
  const head = bytes.toString('utf8', 0, 400)
  width = Number(head.match(/width="([\d.]+)/)?.[1] ?? 0) || null
  height = Number(head.match(/height="([\d.]+)/)?.[1] ?? 0) || null
}
if (!width || !height) {
  console.error('Could not determine dimensions — pass --width and --height.')
  process.exit(1)
}

const manifestPath = resolve(libDir, 'library.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.entries = manifest.entries.filter(e => e.id !== id)
manifest.entries.push({ id, kind, label, file, width, height })
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Added ${id} (${width}×${height}) → ${file}`)
console.log('Reminder: Scratch assets are CC BY-SA 4.0 — keep the attribution.')
```

Do not run this script as part of the task — the starter set is what ships. Note in your report whether network access was available.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/ide/library.test.ts && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ide/library.ts src/ide/library.test.ts public/library scripts/fetch-scratch-library.mjs
git commit -m "feat: asset library manifest, resolver, and starter set"
```

---

### Task 4: Runtime session — payload to a running World

**Files:**
- Create: `src/runtime-host/session.ts`, `src/runtime-host/keys.ts`
- Test: `src/runtime-host/session.test.ts`, `src/runtime-host/keys.test.ts`

**Interfaces:**
- Consumes: `World`, `Executor`, `RunPayload`, `ScriptIssue`.
- Produces: `keyName(key: string): string`; `class RuntimeSession` with `constructor(payload: RunPayload, handlers: { onIssue; onLog; onStopped })`, fields `world`, and methods `start(): void`, `step(dtSeconds: number): void` (clamps dt to `MAX_DT`), `snapshot()`, `stop(): void`, plus input passthroughs `keyDown/keyUp/mouseMove/mouseDown/mouseUp/clickAt`. Task 5's `main.ts` owns one session per run.
- `MAX_DT = 0.1` — after a tab switch the browser hands you one enormous delta; without a clamp every `glide` finishes instantly and collisions tunnel.
- `stopAll()` called from a script must reach the parent: the session polls `world.running` in `step` and fires `onStopped` once on the transition.

- [ ] **Step 1: Write the failing tests**

`src/runtime-host/keys.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { keyName } from './keys'

describe('keyName', () => {
  it('maps arrows to Scratch-style names', () => {
    expect(keyName('ArrowRight')).toBe('right')
    expect(keyName('ArrowLeft')).toBe('left')
    expect(keyName('ArrowUp')).toBe('up')
    expect(keyName('ArrowDown')).toBe('down')
  })

  it('maps the space bar and enter', () => {
    expect(keyName(' ')).toBe('space')
    expect(keyName('Enter')).toBe('enter')
  })

  it('lowercases letters and passes digits through', () => {
    expect(keyName('A')).toBe('a')
    expect(keyName('a')).toBe('a')
    expect(keyName('7')).toBe('7')
  })

  it('lowercases anything else it does not know', () => {
    expect(keyName('Escape')).toBe('escape')
  })
})
```

`src/runtime-host/session.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { RuntimeSession, MAX_DT } from './session'
import type { RunPayload } from '../shared/protocol'

const costume = { name: 'a', width: 20, height: 20, dataUrl: 'data:image/svg+xml,a' }
const backdrop = { name: 'sky', width: 480, height: 360, dataUrl: 'data:image/svg+xml,sky' }

function payload(script: string, mainScript = ''): RunPayload {
  return {
    sprites: [{
      name: 'Cat', x: 0, y: 0, size: 100, direction: 90, visible: true,
      costumes: [costume], currentCostume: 0, script,
    }],
    backdrops: [backdrop],
    currentBackdrop: 0,
    sounds: [{ name: 'meow', dataUrl: 'data:audio/wav,meow' }],
    mainScript,
  }
}

function setup(p: RunPayload) {
  const onIssue = vi.fn()
  const onLog = vi.fn()
  const onStopped = vi.fn()
  const session = new RuntimeSession(p, { onIssue, onLog, onStopped })
  return { session, onIssue, onLog, onStopped }
}

describe('RuntimeSession', () => {
  it('builds sprites from the payload and runs their scripts on start', async () => {
    const { session, onIssue } = setup(payload('onStart(() => { sprite.move(10) })'))
    session.start()
    await Promise.resolve()
    expect(onIssue).not.toHaveBeenCalled()
    expect(session.snapshot().sprites[0].x).toBeCloseTo(10)
  })

  it('applies payload sprite state and the chosen backdrop', () => {
    const p = payload('')
    p.sprites[0].x = 50
    p.sprites[0].size = 150
    p.sprites[0].visible = false
    const { session } = setup(p)
    session.start()
    const snap = session.snapshot()
    expect(snap.sprites[0]).toMatchObject({ x: 50, size: 150, visible: false })
    expect(snap.backdrop).toBe('sky')
  })

  it('reports script issues and logs to the handlers', async () => {
    const { session, onIssue, onLog } = setup(
      payload('onStart(() => {\n  sprite.move("fast")\n})', 'console.log("hi")'),
    )
    session.start()
    await Promise.resolve()
    expect(onLog).toHaveBeenCalledWith('hi')
    expect(onIssue).toHaveBeenCalledOnce()
    expect(onIssue.mock.calls[0][0]).toMatchObject({ tab: 'Cat', line: 2 })
  })

  it('clamps oversized frame deltas', () => {
    const { session } = setup(payload('onUpdate(() => {})'))
    session.start()
    session.step(5)
    expect(session.world.clock.now).toBeCloseTo(MAX_DT)
  })

  it('fires onStopped once when a script calls stopAll', async () => {
    const { session, onStopped } = setup(payload('onStart(() => { stopAll() })'))
    session.start()
    await Promise.resolve()
    session.step(0.016)
    session.step(0.016)
    expect(onStopped).toHaveBeenCalledOnce()
  })

  it('stops ticking the world after stop()', () => {
    const { session } = setup(payload(''))
    session.start()
    session.stop()
    session.step(0.5)
    expect(session.world.clock.now).toBe(0)
  })

  it('forwards input to the world', () => {
    const { session } = setup(payload(''))
    session.start()
    session.keyDown('right')
    expect(session.world.keys.has('right')).toBe(true)
    session.keyUp('right')
    expect(session.world.keys.has('right')).toBe(false)
    session.mouseDown(10, 20)
    expect(session.world.mouse).toMatchObject({ x: 10, y: 20, isDown: true })
    session.mouseUp()
    expect(session.world.mouse.isDown).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/runtime-host/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`src/runtime-host/keys.ts`:
```ts
const NAMED: Record<string, string> = {
  ArrowRight: 'right',
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ' ': 'space',
  Enter: 'enter',
  Escape: 'escape',
}

/** Browser KeyboardEvent.key → the names kids write in onKeyPress/keyIsDown. */
export function keyName(key: string): string {
  return NAMED[key] ?? key.toLowerCase()
}
```

`src/runtime-host/session.ts`:
```ts
import { World } from '../runtime/world'
import { Executor, type ScriptIssue } from '../runtime/executor'
import type { RunPayload } from '../shared/protocol'

/**
 * One frame delta can be enormous after a background tab wakes up. Without a
 * clamp, every glide completes in a single step and fast sprites tunnel
 * through each other.
 */
export const MAX_DT = 0.1

export interface SessionHandlers {
  onIssue: (issue: ScriptIssue) => void
  onLog: (text: string) => void
  onStopped: () => void
}

export class RuntimeSession {
  readonly world: World
  private executor: Executor
  private started = false
  private halted = false

  constructor(
    private payload: RunPayload,
    private handlers: SessionHandlers,
  ) {
    this.world = new World({
      backdrops: payload.backdrops.map(b => ({
        name: b.name, width: b.width, height: b.height, source: b.dataUrl,
      })),
      soundNames: payload.sounds.map(s => s.name),
    })
    this.world.stage.currentBackdrop = payload.currentBackdrop
    for (const s of payload.sprites) {
      const model = this.world.addSprite(
        s.name,
        s.costumes.map(c => ({
          name: c.name, width: c.width, height: c.height, source: c.dataUrl,
        })),
      )
      model.x = s.x
      model.y = s.y
      model.size = s.size
      model.direction = s.direction
      model.visible = s.visible
      model.currentCostume = s.currentCostume
    }
    this.executor = new Executor(this.world, {
      onIssue: issue => this.handlers.onIssue(issue),
      onLog: text => this.handlers.onLog(text),
    })
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.executor.run({
      mainScript: this.payload.mainScript,
      spriteScripts: this.payload.sprites.map(s => ({ name: s.name, script: s.script })),
    })
    this.checkHalted()
  }

  step(dtSeconds: number): void {
    if (!this.started || this.halted) return
    this.world.tick(Math.min(dtSeconds, MAX_DT))
    this.checkHalted()
  }

  snapshot() {
    return this.world.snapshot()
  }

  stop(): void {
    if (this.halted) return
    this.halted = true
    this.world.stopAll()
  }

  keyDown(key: string): void {
    this.world.keyDown(key)
  }
  keyUp(key: string): void {
    this.world.keyUp(key)
  }
  mouseMove(x: number, y: number): void {
    this.world.mouseMove(x, y)
  }
  mouseDown(x: number, y: number): void {
    this.world.mouseDown(x, y)
  }
  mouseUp(): void {
    this.world.mouseUp()
  }
  clickAt(x: number, y: number): void {
    this.world.clickAt(x, y)
  }

  /** A script calling stopAll() flips world.running; tell the parent once. */
  private checkHalted(): void {
    if (this.halted || this.world.running) return
    this.halted = true
    this.handlers.onStopped()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/runtime-host/ && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime-host/session.ts src/runtime-host/keys.ts src/runtime-host/session.test.ts src/runtime-host/keys.test.ts
git commit -m "feat: runtime session builds and drives a World from a run payload"
```

---

### Task 5: Phaser renderer and the iframe entry point

**Files:**
- Create: `src/runtime-host/spriteViews.ts`, `src/runtime-host/scene.ts`
- Modify: `src/runtime-host/main.ts` (replace the Task 1 stub)
- Test: `src/runtime-host/spriteViews.test.ts`

**Interfaces:**
- Consumes: `RuntimeSession`, `keyName`, snapshot shape from `World.snapshot()`.
- Produces: `toPhaserX(x)`, `toPhaserY(y)`, `toStageX(px)`, `toStageY(py)`, `viewFor(snapSprite): SpriteView`, `reconcile(prevIds: Set<number>, snapshot): { create: number[]; update: SpriteView[]; destroy: number[]; order: number[] }`; `class StageScene extends Phaser.Scene`; `main.ts` wiring.
- `SpriteView` is the fully-computed render state — Phaser coordinates, angle, alpha, flip, depth, texture key, bubble text — so all the mapping math is pure and testable and the scene only assigns properties.

- [ ] **Step 1: Write the failing test**

`src/runtime-host/spriteViews.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { toPhaserX, toPhaserY, toStageX, toStageY, viewFor, reconcile } from './spriteViews'

const snapSprite = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over })
function base() {
  return {
    id: 1, name: 'Cat', x: 0, y: 0, direction: 90, size: 100, visible: true,
    rotationStyle: 'all around' as const, costume: 'cat-a',
    effects: {} as Record<string, number>,
    bubble: null as { text: string; kind: 'say' | 'think' } | null,
    isClone: false,
  }
}

describe('coordinate mapping', () => {
  it('maps stage centre to canvas centre and flips y', () => {
    expect(toPhaserX(0)).toBe(240)
    expect(toPhaserY(0)).toBe(180)
    expect(toPhaserY(180)).toBe(0)
    expect(toPhaserX(-240)).toBe(0)
  })

  it('round-trips back to stage coordinates', () => {
    expect(toStageX(toPhaserX(37))).toBeCloseTo(37)
    expect(toStageY(toPhaserY(-42))).toBeCloseTo(-42)
  })
})

describe('viewFor', () => {
  it('converts position, angle, and scale', () => {
    const v = viewFor(snapSprite({ x: 10, y: 20, direction: 180, size: 50 }), 0)
    expect(v).toMatchObject({ id: 1, px: 250, py: 160, angle: 90, scale: 0.5, depth: 0 })
  })

  it('maps ghost effect to alpha and hides invisible sprites', () => {
    expect(viewFor(snapSprite({ effects: { ghost: 25 } }), 0).alpha).toBeCloseTo(0.75)
    expect(viewFor(snapSprite({ effects: { ghost: 300 } }), 0).alpha).toBe(0)
    expect(viewFor(snapSprite({ visible: false }), 0).alpha).toBe(0)
  })

  it('honours rotation styles', () => {
    const lr = viewFor(snapSprite({ direction: -90, rotationStyle: 'left-right' }), 0)
    expect(lr).toMatchObject({ angle: 0, flipX: true })
    const lrRight = viewFor(snapSprite({ direction: 90, rotationStyle: 'left-right' }), 0)
    expect(lrRight).toMatchObject({ angle: 0, flipX: false })
    const none = viewFor(snapSprite({ direction: 45, rotationStyle: "don't rotate" }), 0)
    expect(none.angle).toBe(0)
  })

  it('carries the bubble and texture key', () => {
    const v = viewFor(snapSprite({ bubble: { text: 'Hi', kind: 'say' }, costume: 'cat-b' }), 3)
    expect(v.bubble).toEqual({ text: 'Hi', kind: 'say' })
    expect(v.texture).toBe('cat-b')
    expect(v.depth).toBe(3)
  })
})

describe('reconcile', () => {
  const snap = (ids: number[]) => ({
    sprites: ids.map(id => snapSprite({ id })),
  })

  it('creates views for new ids and destroys vanished ones', () => {
    const first = reconcile(new Set(), snap([1, 2]))
    expect(first.create).toEqual([1, 2])
    expect(first.destroy).toEqual([])
    const second = reconcile(new Set([1, 2]), snap([2, 3]))
    expect(second.create).toEqual([3])
    expect(second.destroy).toEqual([1])
  })

  it('reports depth from array order, back to front', () => {
    const r = reconcile(new Set([1, 2]), snap([2, 1]))
    expect(r.order).toEqual([2, 1])
    expect(r.update.map(v => [v.id, v.depth])).toEqual([[2, 0], [1, 1]])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runtime-host/spriteViews.test.ts`
Expected: FAIL — cannot resolve `./spriteViews`.

- [ ] **Step 3: Write the pure view module**

`src/runtime-host/spriteViews.ts`:
```ts
import { STAGE_WIDTH, STAGE_HEIGHT } from '../runtime/spriteModel'

type SnapshotSprite = ReturnType<
  import('../runtime/world').World['snapshot']
>['sprites'][number]

export interface SpriteView {
  id: number
  px: number
  py: number
  angle: number
  scale: number
  alpha: number
  flipX: boolean
  depth: number
  texture: string | null
  bubble: { text: string; kind: 'say' | 'think' } | null
}

export const toPhaserX = (x: number): number => STAGE_WIDTH / 2 + x
export const toPhaserY = (y: number): number => STAGE_HEIGHT / 2 - y
export const toStageX = (px: number): number => px - STAGE_WIDTH / 2
export const toStageY = (py: number): number => STAGE_HEIGHT / 2 - py

/** Everything the scene needs, already in Phaser's coordinate space. */
export function viewFor(s: SnapshotSprite, depth: number): SpriteView {
  const ghost = s.effects.ghost ?? 0
  const alpha = s.visible ? Math.min(1, Math.max(0, 1 - ghost / 100)) : 0
  const leftRight = s.rotationStyle === 'left-right'
  return {
    id: s.id,
    px: toPhaserX(s.x),
    py: toPhaserY(s.y),
    angle: s.rotationStyle === 'all around' ? s.direction - 90 : 0,
    scale: s.size / 100,
    alpha,
    flipX: leftRight && s.direction < 0,
    depth,
    texture: s.costume,
    bubble: s.bubble,
  }
}

export function reconcile(
  prevIds: Set<number>,
  snapshot: { sprites: SnapshotSprite[] },
): { create: number[]; update: SpriteView[]; destroy: number[]; order: number[] } {
  const update = snapshot.sprites.map((s, i) => viewFor(s, i))
  const liveIds = new Set(update.map(v => v.id))
  return {
    create: update.filter(v => !prevIds.has(v.id)).map(v => v.id),
    update,
    destroy: [...prevIds].filter(id => !liveIds.has(id)),
    order: update.map(v => v.id),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/runtime-host/spriteViews.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the Phaser scene**

`src/runtime-host/scene.ts`:
```ts
import Phaser from 'phaser'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../runtime/spriteModel'
import { RuntimeSession } from './session'
import { reconcile, toStageX, toStageY, type SpriteView } from './spriteViews'
import { keyName } from './keys'
import type { RunPayload } from '../shared/protocol'

interface SpriteEntry {
  image: Phaser.GameObjects.Image
  bubble: Phaser.GameObjects.Container | null
  bubbleText: string | null
}

export class StageScene extends Phaser.Scene {
  private entries = new Map<number, SpriteEntry>()
  private backdrop: Phaser.GameObjects.Image | null = null
  private watchText: Phaser.GameObjects.Text | null = null
  private audio = new Map<string, string>()
  private playing = new Set<HTMLAudioElement>()

  constructor(
    private session: RuntimeSession,
    private payload: RunPayload,
  ) {
    super('stage')
  }

  preload(): void {
    for (const s of this.payload.sprites) {
      for (const c of s.costumes) {
        if (!this.textures.exists(c.name)) this.load.image(c.name, c.dataUrl)
      }
    }
    for (const b of this.payload.backdrops) {
      if (!this.textures.exists(b.name)) this.load.image(b.name, b.dataUrl)
    }
    for (const s of this.payload.sounds) this.audio.set(s.name, s.dataUrl)
  }

  create(): void {
    this.backdrop = this.add
      .image(STAGE_WIDTH / 2, STAGE_HEIGHT / 2, this.payload.backdrops[this.payload.currentBackdrop]?.name ?? '')
      .setDepth(-1000)
      .setDisplaySize(STAGE_WIDTH, STAGE_HEIGHT)

    this.watchText = this.add
      .text(6, 6, '', { fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: '#1a1a1a', backgroundColor: '#ffffffcc' })
      .setDepth(10000)

    this.input.on('pointermove', (p: Phaser.Input.Pointer) =>
      this.session.mouseMove(toStageX(p.x), toStageY(p.y)),
    )
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.session.mouseDown(toStageX(p.x), toStageY(p.y))
      this.session.clickAt(toStageX(p.x), toStageY(p.y))
    })
    this.input.on('pointerup', () => this.session.mouseUp())
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.session.keyDown(keyName(e.key)))
    this.input.keyboard?.on('keyup', (e: KeyboardEvent) => this.session.keyUp(keyName(e.key)))

    this.session.start()
    this.render()
  }

  update(_time: number, deltaMs: number): void {
    this.session.step(deltaMs / 1000)
    this.render()
  }

  private render(): void {
    const snap = this.session.snapshot()
    const { create, update, destroy } = reconcile(new Set(this.entries.keys()), snap)

    for (const id of create) {
      const view = update.find(v => v.id === id)!
      const image = this.add.image(view.px, view.py, view.texture ?? '')
      this.entries.set(id, { image, bubble: null, bubbleText: null })
    }
    for (const id of destroy) {
      const entry = this.entries.get(id)
      entry?.image.destroy()
      entry?.bubble?.destroy()
      this.entries.delete(id)
    }
    for (const view of update) this.applyView(view)

    if (this.backdrop && snap.backdrop && this.backdrop.texture.key !== snap.backdrop) {
      this.backdrop.setTexture(snap.backdrop).setDisplaySize(STAGE_WIDTH, STAGE_HEIGHT)
    }
    if (this.watchText) {
      this.watchText.setText(snap.watches.map(w => `${w.name}: ${w.value}`).join('\n'))
    }
    for (const sound of snap.sounds) this.playSound(sound.id, sound.name)
  }

  private applyView(view: SpriteView): void {
    const entry = this.entries.get(view.id)
    if (!entry) return
    const { image } = entry
    if (view.texture && image.texture.key !== view.texture) image.setTexture(view.texture)
    image.setPosition(view.px, view.py)
    image.setAngle(view.angle)
    image.setScale(view.scale)
    image.setAlpha(view.alpha)
    image.setFlipX(view.flipX)
    image.setDepth(view.depth)
    this.applyBubble(entry, view)
  }

  private applyBubble(entry: SpriteEntry, view: SpriteView): void {
    const wanted = view.bubble && view.alpha > 0 ? view.bubble.text : null
    if (wanted === null) {
      entry.bubble?.destroy()
      entry.bubble = null
      entry.bubbleText = null
      return
    }
    if (entry.bubbleText !== wanted) {
      entry.bubble?.destroy()
      const text = this.add.text(0, 0, wanted, {
        fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#1a1a1a',
        wordWrap: { width: 160 },
      })
      const pad = 6
      const bg = this.add.graphics()
      bg.fillStyle(0xffffff, 0.95)
      bg.lineStyle(1, 0xb0b0b0, 1)
      bg.fillRoundedRect(-pad, -pad, text.width + pad * 2, text.height + pad * 2, 8)
      bg.strokeRoundedRect(-pad, -pad, text.width + pad * 2, text.height + pad * 2, 8)
      const container = this.add.container(0, 0, [bg, text])
      entry.bubble = container
      entry.bubbleText = wanted
    }
    const halfH = (entry.image.displayHeight || 0) / 2
    entry.bubble!.setPosition(view.px + 12, view.py - halfH - 34).setDepth(view.depth + 500)
  }

  private playSound(id: number, name: string): void {
    const url = this.audio.get(name)
    if (!url) return
    const el = new Audio(url)
    el.volume = Math.min(1, Math.max(0, this.session.world.volume / 100))
    this.playing.add(el)
    const finish = () => {
      this.playing.delete(el)
      this.session.world.soundFinished(id)
    }
    el.addEventListener('ended', finish)
    void el.play().catch(finish)
  }

  /**
   * Silence anything still playing. Audio elements live outside Phaser's
   * destroy graph, so without this a sound outlives the run that started it
   * and bleeds into the next one.
   */
  stopSounds(): void {
    for (const el of this.playing) {
      el.pause()
      el.currentTime = 0
    }
    this.playing.clear()
  }
}
```

- [ ] **Step 6: Wire the iframe entry**

`src/runtime-host/main.ts` (replace the whole file):
```ts
import Phaser from 'phaser'
import { STAGE_WIDTH, STAGE_HEIGHT } from '../runtime/spriteModel'
import { isIdeMessage, type RunPayload } from '../shared/protocol'
import { RuntimeSession } from './session'
import { StageScene } from './scene'

let game: Phaser.Game | null = null
let scene: StageScene | null = null

function post(message: unknown): void {
  parent.postMessage(message, '*')
}

function startRun(payload: RunPayload): void {
  scene?.stopSounds()
  game?.destroy(true)
  const session = new RuntimeSession(payload, {
    onIssue: issue => post({ type: 'issue', issue }),
    onLog: text => post({ type: 'log', text }),
    onStopped: () => {
      scene?.stopSounds()
      post({ type: 'stopped' })
    },
  })
  // Assign `scene` before booting the game: the session's handlers close over
  // this module variable and may fire as soon as the scene creates.
  const s = new StageScene(session, payload)
  scene = s
  game = new Phaser.Game({
    type: Phaser.AUTO,
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    parent: 'stage',
    backgroundColor: '#ffffff',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: s,
  })
}

window.addEventListener('message', event => {
  if (isIdeMessage(event.data)) startRun(event.data.payload)
})

post({ type: 'ready' })
```

- [ ] **Step 7: Verify build and suite**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds with both entries.

- [ ] **Step 8: Commit**

```bash
git add src/runtime-host/
git commit -m "feat: Phaser stage renderer and sandboxed iframe entry point"
```

---

### Task 6: IDE state store and shell layout

**Files:**
- Create: `src/ide/store.ts`, `src/ide/components/App.tsx`, `src/ide/components/SpriteList.tsx`, `src/ide/components/StagePanel.tsx`, `src/ide/styles.css`
- Modify: `src/App.tsx` (render the IDE), `src/main.tsx` (import the stylesheet)
- Test: `src/ide/store.test.ts`

**Interfaces:**
- Consumes: `Project` helpers (Task 2), `library` (Task 3).
- Produces: `IdeState { project: Project; selectedTab: string; running: boolean; console: ConsoleLine[] }`, `ConsoleLine { kind: 'log' | 'issue'; text: string }`, `initialState(project)`, `reducer(state, action): IdeState` with actions `select-tab`, `add-sprite`, `add-backdrop`, `delete-sprite`, `rename-sprite`, `set-script`, `run`, `stop`, `log`, `issue`, `clear-console`. Tasks 7-9 dispatch these.
- Selecting a deleted sprite falls back to `'main'`; `run` clears the console and bumps `runId` so the iframe remounts.

- [ ] **Step 1: Write the failing test**

`src/ide/store.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { initialState, reducer } from './store'
import { createEmptyProject, addSprite, type AssetRef } from '../shared/project'

const costume: AssetRef = { name: 'cat-a', source: 'library:cat-a' }
const withCat = () => initialState(addSprite(createEmptyProject(), 'Cat', [costume]))

describe('ide reducer', () => {
  it('starts on the main tab, not running, console empty', () => {
    const s = initialState(createEmptyProject())
    expect(s).toMatchObject({ selectedTab: 'main', running: false, console: [], runId: 0 })
  })

  it('adds a sprite, uniquifies its name, and selects it', () => {
    let s = reducer(withCat(), { type: 'add-sprite', name: 'Cat', costumes: [costume] })
    expect(s.project.sprites.map(x => x.name)).toEqual(['Cat', 'Cat2'])
    expect(s.selectedTab).toBe('Cat2')
  })

  it('adds a backdrop without touching the selected tab', () => {
    const s = reducer(withCat(), {
      type: 'add-backdrop',
      ref: { name: 'night', source: 'library:night' },
    })
    expect(s.project.stage.backdrops.map(b => b.name)).toEqual(['blue-sky', 'night'])
    expect(s.project.stage.currentBackdrop).toBe(1)
    expect(s.selectedTab).toBe('main')
  })

  it('falls back to main when the selected sprite is deleted', () => {
    let s = reducer(withCat(), { type: 'select-tab', tab: 'Cat' })
    s = reducer(s, { type: 'delete-sprite', name: 'Cat' })
    expect(s.project.sprites).toEqual([])
    expect(s.selectedTab).toBe('main')
  })

  it('follows the selection through a rename and ignores duplicate names', () => {
    let s = reducer(withCat(), { type: 'select-tab', tab: 'Cat' })
    s = reducer(s, { type: 'rename-sprite', from: 'Cat', to: 'Kitty' })
    expect(s.selectedTab).toBe('Kitty')
    s = reducer(s, { type: 'add-sprite', name: 'Bat', costumes: [costume] })
    const before = s
    s = reducer(s, { type: 'rename-sprite', from: 'Bat', to: 'Kitty' })
    expect(s.project.sprites.map(x => x.name)).toEqual(before.project.sprites.map(x => x.name))
    expect(s.console.at(-1)?.kind).toBe('issue')
  })

  it('writes scripts to the right tab', () => {
    let s = reducer(withCat(), { type: 'set-script', tab: 'main', script: 'vars.score = 0' })
    s = reducer(s, { type: 'set-script', tab: 'Cat', script: 'onStart(() => {})' })
    expect(s.project.mainScript).toBe('vars.score = 0')
    expect(s.project.sprites[0].script).toBe('onStart(() => {})')
  })

  it('run clears the console, sets running, and bumps runId', () => {
    let s = reducer(withCat(), { type: 'log', text: 'stale' })
    s = reducer(s, { type: 'run' })
    expect(s).toMatchObject({ running: true, console: [], runId: 1 })
    s = reducer(s, { type: 'stop' })
    expect(s.running).toBe(false)
    expect(reducer(s, { type: 'run' }).runId).toBe(2)
  })

  it('appends logs and issues with a readable location', () => {
    let s = reducer(withCat(), { type: 'log', text: 'hello' })
    s = reducer(s, { type: 'issue', issue: { tab: 'Cat', line: 3, message: 'boom' } })
    expect(s.console[0]).toEqual({ kind: 'log', text: 'hello' })
    expect(s.console[1]).toEqual({ kind: 'issue', text: 'In Cat, line 3: boom' })
    s = reducer(s, { type: 'issue', issue: { tab: 'main', line: null, message: 'bad' } })
    expect(s.console[2].text).toBe('In main: bad')
    expect(reducer(s, { type: 'clear-console' }).console).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ide/store.test.ts`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 3: Write the store**

`src/ide/store.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ide/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the shell components**

`src/ide/styles.css`:
```css
:root { --border: #d8dce3; --bg: #f6f7f9; --panel: #ffffff; --accent: #3b6fd4; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a; }
.ide { display: grid; grid-template-columns: 520px 1fr; height: 100vh; background: var(--bg); }
.panel { display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--border); background: var(--panel); }
.panel:last-child { border-right: none; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.toolbar h1 { font-size: 15px; margin: 0 auto 0 0; font-weight: 600; }
button { font: inherit; padding: 5px 12px; border: 1px solid var(--border); border-radius: 6px; background: #fff; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: #1f9d4d; border-color: #1a8642; color: #fff; }
button.danger { background: #d34b4b; border-color: #b93f3f; color: #fff; }
.stage-frame { width: 480px; height: 360px; border: 1px solid var(--border); background: #fff; margin: 12px; }
.stage-frame iframe { width: 100%; height: 100%; border: 0; display: block; }
.stage-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #7a7f88; font-size: 14px; }
.sprite-list { flex: 1; overflow: auto; padding: 8px 12px; border-top: 1px solid var(--border); }
.sprite-list h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin: 4px 0 8px; }
.sprite-row { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 6px; cursor: pointer; }
.sprite-row.selected { background: #e8effc; }
.sprite-row img { width: 28px; height: 28px; object-fit: contain; }
.sprite-row span { flex: 1; font-size: 14px; }
.tabs { display: flex; gap: 4px; padding: 8px 12px 0; overflow-x: auto; }
.tab { padding: 6px 12px; border: 1px solid var(--border); border-bottom: none; border-radius: 6px 6px 0 0; background: var(--bg); cursor: pointer; white-space: nowrap; }
.tab.active { background: #fff; font-weight: 600; }
.editor { flex: 1; min-height: 0; border-top: 1px solid var(--border); }
.console { height: 160px; overflow: auto; border-top: 1px solid var(--border); padding: 8px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.console .issue { color: #b3261e; }
.console .empty { color: #9aa0a6; }
.drawer { width: 320px; border-left: 1px solid var(--border); overflow: auto; padding: 12px; }
.drawer input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 10px; font: inherit; }
.drawer h3 { font-size: 12px; text-transform: uppercase; color: #6b7280; margin: 14px 0 6px; }
.api-entry { border: 1px solid var(--border); border-radius: 6px; padding: 8px; margin-bottom: 6px; }
.api-entry code { font-size: 12px; color: #1f3d7a; }
.api-entry p { margin: 4px 0 6px; font-size: 12px; color: #444; }
.code-area { display: flex; flex: 1; min-height: 0; }
.code-main { display: flex; flex-direction: column; flex: 1; min-width: 0; }
```

`src/ide/components/StagePanel.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { RuntimeBridge } from '../bridge'
import type { RunPayload } from '../../shared/protocol'
import type { ScriptIssue } from '../../runtime/executor'

interface Props {
  runId: number
  running: boolean
  payload: RunPayload | null
  onIssue: (issue: ScriptIssue) => void
  onLog: (text: string) => void
  onStopped: () => void
}

/**
 * Mounts the sandboxed runtime iframe. The `key={runId}` on this component's
 * iframe is load-bearing: a new run must get a brand-new document, because the
 * engine's Executor cannot be re-run against an existing World.
 */
export function StagePanel({ runId, running, payload, onIssue, onLog, onStopped }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const bridgeRef = useRef<RuntimeBridge | null>(null)

  useEffect(() => {
    if (!running || !payload) return
    const target = frameRef.current?.contentWindow
    if (!target) return

    const bridge = new RuntimeBridge(target, { onIssue, onLog, onStopped })
    bridgeRef.current = bridge
    const listener = (event: MessageEvent) => {
      if (event.source === target) bridge.handleMessage(event.data)
    }
    window.addEventListener('message', listener)
    bridge.run(payload)
    return () => {
      window.removeEventListener('message', listener)
      bridge.dispose()
      bridgeRef.current = null
    }
  }, [runId, running, payload, onIssue, onLog, onStopped])

  return (
    <div className="stage-frame">
      {running ? (
        <iframe
          key={runId}
          ref={frameRef}
          src="/runtime.html"
          title="Game stage"
          sandbox="allow-scripts"
          // Belt and braces for the ready handshake: if the iframe's script
          // ran (and posted `ready`) before this effect attached its listener,
          // the load event still guarantees delivery. RuntimeBridge ignores a
          // second `ready`, so at most one run payload is ever sent.
          onLoad={() => bridgeRef.current?.handleMessage({ type: 'ready' })}
        />
      ) : (
        <div className="stage-empty">Press Run to play your game</div>
      )}
    </div>
  )
}
```

`src/ide/components/SpriteList.tsx`:
```tsx
import type { Project } from '../../shared/project'

interface Props {
  project: Project
  selectedTab: string
  costumeUrl: (source: string) => string
  onSelect: (name: string) => void
  onAdd: () => void
  onRename: (from: string) => void
  onDelete: (name: string) => void
}

export function SpriteList({
  project, selectedTab, costumeUrl, onSelect, onAdd, onRename, onDelete,
}: Props) {
  return (
    <div className="sprite-list">
      <h2>Sprites</h2>
      {project.sprites.length === 0 && <p className="stage-empty">No sprites yet.</p>}
      {project.sprites.map(sprite => (
        <div
          key={sprite.name}
          className={`sprite-row${selectedTab === sprite.name ? ' selected' : ''}`}
          onClick={() => onSelect(sprite.name)}
        >
          <img src={costumeUrl(sprite.costumes[sprite.currentCostume]?.source ?? '')} alt="" />
          <span>{sprite.name}</span>
          <button onClick={e => { e.stopPropagation(); onRename(sprite.name) }}>Rename</button>
          <button onClick={e => { e.stopPropagation(); onDelete(sprite.name) }}>Delete</button>
        </div>
      ))}
      <button onClick={onAdd}>+ Add sprite</button>
    </div>
  )
}
```

`src/ide/components/App.tsx` (Task 9 replaces the body with the full wiring; this version proves the layout):
```tsx
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
```

`src/App.tsx` (replace):
```tsx
import { App as IdeApp } from './ide/components/App'

export default function App() {
  return <IdeApp />
}
```

`src/main.tsx` — add the stylesheet import after the existing imports:
```tsx
import './ide/styles.css'
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run build`
Expected: PASS and a successful build.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: IDE state store and shell layout"
```

---

### Task 7: Monaco editor with API-driven autocomplete

**Files:**
- Create: `src/ide/completions.ts`, `src/ide/components/CodeEditor.tsx`, `src/ide/monacoSetup.ts`
- Test: `src/ide/completions.test.ts`

**Interfaces:**
- Consumes: `API_DEFS` (Plan 1).
- Produces: `CompletionItem { label: string; insertText: string; detail: string; documentation: string; kind: 'method' | 'property' }`, `completionsFor(scope: 'main' | 'sprite'): CompletionItem[]`, `spriteMemberCompletions(): CompletionItem[]`, `<CodeEditor value onChange tab />`.
- Two completion sets: typing at top level offers globals (plus `sprite` in sprite tabs); typing after `sprite.` offers the facade members. `insertText` strips the `sprite.`/`stage.` prefix where the prefix is already typed.

- [ ] **Step 1: Write the failing test**

`src/ide/completions.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { completionsFor, spriteMemberCompletions } from './completions'
import { API_DEFS } from '../shared/apiDefs'

describe('completions', () => {
  it('offers every global to main scripts, and no sprite-only members', () => {
    const labels = completionsFor('main').map(c => c.label)
    expect(labels).toContain('onStart')
    expect(labels).toContain('broadcast')
    expect(labels).toContain('vars')
    expect(labels).not.toContain('move')
  })

  it('offers globals plus the sprite object in sprite scripts', () => {
    const labels = completionsFor('sprite').map(c => c.label)
    expect(labels).toContain('sprite')
    expect(labels).toContain('onClick')
    expect(labels).toContain('onStart')
  })

  it('lists dotted globals under their root only once', () => {
    const labels = completionsFor('main').map(c => c.label)
    expect(labels.filter(l => l === 'stage')).toHaveLength(1)
  })

  it('member completions cover every sprite-scoped def and strip the prefix', () => {
    const members = spriteMemberCompletions()
    const spriteDefs = API_DEFS.filter(d => d.scope === 'sprite')
    expect(members).toHaveLength(spriteDefs.length)
    const move = members.find(m => m.label === 'move')!
    expect(move.insertText).toBe('move(10)')
    expect(move.documentation).toContain('Walk forward')
    expect(move.detail).toBe('sprite.move(steps)')
  })

  it('marks value-like entries as properties', () => {
    const x = spriteMemberCompletions().find(m => m.label === 'x')!
    expect(x.kind).toBe('property')
    const move = spriteMemberCompletions().find(m => m.label === 'move')!
    expect(move.kind).toBe('method')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ide/completions.test.ts`
Expected: FAIL — cannot resolve `./completions`.

- [ ] **Step 3: Write the implementation**

`src/ide/completions.ts`:
```ts
import { API_DEFS, type ApiDef } from '../shared/apiDefs'

export interface CompletionItem {
  label: string
  insertText: string
  detail: string
  documentation: string
  kind: 'method' | 'property'
}

const kindOf = (def: ApiDef): 'method' | 'property' =>
  def.signature.includes('(') ? 'method' : 'property'

/** `sprite.move(10)` → `move(10)`; `mouse.x, mouse.y…` → `mouse` */
function insertTextFor(def: ApiDef, stripPrefix: boolean): string {
  const example = def.example.split('\n')[0].replace(/^await /, '')
  if (stripPrefix && example.startsWith('sprite.')) return example.slice('sprite.'.length)
  if (!stripPrefix && def.name.includes('.')) return def.name.split('.')[0]
  return example
}

function toItem(def: ApiDef, stripPrefix: boolean): CompletionItem {
  return {
    label: stripPrefix ? def.name : def.name.split('.')[0],
    insertText: insertTextFor(def, stripPrefix),
    detail: def.signature,
    documentation: def.description,
    kind: kindOf(def),
  }
}

/** Top-level identifiers available in a tab. */
export function completionsFor(scope: 'main' | 'sprite'): CompletionItem[] {
  const items = new Map<string, CompletionItem>()
  for (const def of API_DEFS) {
    if (def.scope !== 'global') continue
    const item = toItem(def, false)
    if (!items.has(item.label)) items.set(item.label, item)
  }
  if (scope === 'sprite') {
    items.set('sprite', {
      label: 'sprite',
      insertText: 'sprite',
      detail: 'sprite',
      documentation: 'This sprite. Try sprite.move(10) or sprite.say("Hi").',
      kind: 'property',
    })
  }
  return [...items.values()]
}

/** Members offered after typing `sprite.` */
export function spriteMemberCompletions(): CompletionItem[] {
  return API_DEFS.filter(d => d.scope === 'sprite').map(d => toItem(d, true))
}
```

`src/ide/monacoSetup.ts`:
```ts
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { completionsFor, spriteMemberCompletions } from './completions'

// Bundle Monaco from npm instead of the default CDN loader: the app must work
// offline and under a strict CSP.
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    return label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker()
  },
}
loader.config({ monaco })

let registered = false

export function registerGameCompletions(scopeOf: () => 'main' | 'sprite'): void {
  if (registered) return
  registered = true
  monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const line = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      const afterSpriteDot = /sprite\.\w*$/.test(line)
      const items = afterSpriteDot ? spriteMemberCompletions() : completionsFor(scopeOf())
      return {
        suggestions: items.map(item => ({
          label: item.label,
          kind:
            item.kind === 'method'
              ? monaco.languages.CompletionItemKind.Method
              : monaco.languages.CompletionItemKind.Property,
          insertText: item.insertText,
          detail: item.detail,
          documentation: item.documentation,
          range,
        })),
      }
    },
  })
}
```

`src/ide/components/CodeEditor.tsx`:
```tsx
import Editor from '@monaco-editor/react'
import { useEffect, useRef } from 'react'
import { registerGameCompletions } from '../monacoSetup'

interface Props {
  tab: string
  value: string
  onChange: (value: string) => void
}

export function CodeEditor({ tab, value, onChange }: Props) {
  // The completion provider is registered once for the app's lifetime, but it
  // must see the tab that is current when the user types — so it reads through
  // a ref that an effect keeps up to date (never mutate during render).
  const tabRef = useRef(tab)
  useEffect(() => {
    tabRef.current = tab
  }, [tab])
  useEffect(() => {
    registerGameCompletions(() => (tabRef.current === 'main' ? 'main' : 'sprite'))
  }, [])

  return (
    <div className="editor">
      <Editor
        height="100%"
        defaultLanguage="javascript"
        path={`file:///${tab}.js`}
        value={value}
        onChange={v => onChange(v ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          tabSize: 2,
          automaticLayout: true,
        }}
      />
    </div>
  )
}
```

`src/vite-env.d.ts` — Vite's client types cover the `?worker` imports Monaco needs:
```ts
/// <reference types="vite/client" />
```

- [ ] **Step 4: Run tests and build**

Run: `npx vitest run src/ide/completions.test.ts && npm test && npm run build`
Expected: PASS; build succeeds (Monaco adds a few MB — expected).

- [ ] **Step 5: Commit**

```bash
git add src/ide/completions.ts src/ide/completions.test.ts src/ide/monacoSetup.ts src/ide/components/CodeEditor.tsx
git commit -m "feat: Monaco editor with completions generated from API_DEFS"
```

---

### Task 8: API reference drawer and console pane

**Files:**
- Create: `src/ide/reference.ts`, `src/ide/components/ApiDrawer.tsx`, `src/ide/components/ConsolePane.tsx`
- Test: `src/ide/reference.test.ts`

**Interfaces:**
- Consumes: `API_DEFS`, `ConsoleLine` (Task 6).
- Produces: `searchApi(query: string): ApiDef[]`, `groupByCategory(defs: ApiDef[]): { category: ApiCategory; defs: ApiDef[] }[]` (categories in the fixed Scratch order, empty groups dropped); `<ApiDrawer onInsert />`, `<ConsolePane lines />`.

- [ ] **Step 1: Write the failing test**

`src/ide/reference.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { searchApi, groupByCategory, CATEGORY_ORDER } from './reference'
import { API_DEFS } from '../shared/apiDefs'

describe('reference search', () => {
  it('returns everything for an empty query', () => {
    expect(searchApi('')).toHaveLength(API_DEFS.length)
    expect(searchApi('   ')).toHaveLength(API_DEFS.length)
  })

  it('matches names case-insensitively', () => {
    expect(searchApi('MOVE').map(d => d.name)).toContain('move')
  })

  it('matches description text so kids can search by intent', () => {
    const hits = searchApi('bubble').map(d => d.name)
    expect(hits).toContain('say')
  })

  it('returns nothing for gibberish', () => {
    expect(searchApi('zzzznotathing')).toEqual([])
  })
})

describe('grouping', () => {
  it('groups in Scratch category order and drops empty groups', () => {
    const groups = groupByCategory(API_DEFS)
    expect(groups.map(g => g.category)).toEqual(CATEGORY_ORDER)
    const single = groupByCategory(API_DEFS.filter(d => d.category === 'Sound'))
    expect(single).toHaveLength(1)
    expect(single[0].category).toBe('Sound')
  })

  it('keeps every def exactly once', () => {
    const total = groupByCategory(API_DEFS).reduce((n, g) => n + g.defs.length, 0)
    expect(total).toBe(API_DEFS.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ide/reference.test.ts`
Expected: FAIL — cannot resolve `./reference`.

- [ ] **Step 3: Write the implementation**

`src/ide/reference.ts`:
```ts
import { API_DEFS, type ApiCategory, type ApiDef } from '../shared/apiDefs'

export const CATEGORY_ORDER: ApiCategory[] = [
  'Motion', 'Looks', 'Sound', 'Events', 'Sensing', 'Control', 'Stage', 'Variables',
]

export function searchApi(query: string): ApiDef[] {
  const q = query.trim().toLowerCase()
  if (q === '') return API_DEFS
  return API_DEFS.filter(
    d =>
      d.name.toLowerCase().includes(q) ||
      d.signature.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q),
  )
}

export function groupByCategory(defs: ApiDef[]): { category: ApiCategory; defs: ApiDef[] }[] {
  return CATEGORY_ORDER.map(category => ({
    category,
    defs: defs.filter(d => d.category === category),
  })).filter(g => g.defs.length > 0)
}
```

`src/ide/components/ApiDrawer.tsx`:
```tsx
import { useMemo, useState } from 'react'
import { groupByCategory, searchApi } from '../reference'

interface Props {
  onInsert: (example: string) => void
}

export function ApiDrawer({ onInsert }: Props) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupByCategory(searchApi(query)), [query])

  return (
    <div className="drawer">
      <input
        value={query}
        placeholder="Search the API…"
        onChange={e => setQuery(e.target.value)}
      />
      {groups.length === 0 && <p className="stage-empty">Nothing matches “{query}”.</p>}
      {groups.map(group => (
        <section key={group.category}>
          <h3>{group.category}</h3>
          {group.defs.map(def => (
            <div className="api-entry" key={`${def.category}-${def.name}`}>
              <code>{def.signature}</code>
              <p>{def.description}</p>
              <button onClick={() => onInsert(def.example)}>Insert example</button>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
```

`src/ide/components/ConsolePane.tsx`:
```tsx
import type { ConsoleLine } from '../store'

export function ConsolePane({ lines }: { lines: ConsoleLine[] }) {
  return (
    <div className="console">
      {lines.length === 0 && <div className="empty">Console output appears here.</div>}
      {lines.map((line, i) => (
        <div key={i} className={line.kind === 'issue' ? 'issue' : undefined}>
          {line.text}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/ide/reference.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ide/reference.ts src/ide/reference.test.ts src/ide/components/ApiDrawer.tsx src/ide/components/ConsolePane.tsx
git commit -m "feat: API reference drawer and console pane"
```

---

### Task 9: Wire it together — library load, Run/Stop, sprite library dialog, uploads

**Files:**
- Create: `src/ide/components/LibraryDialog.tsx`, `src/ide/upload.ts`
- Modify: `src/ide/components/App.tsx` (full wiring), `src/ide/components/SpriteList.tsx` (real costume thumbnails)
- Test: `src/ide/upload.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `measureImage(dataUrl, loadImage): Promise<{ width: number; height: number }>`, `downscale(width, height, maxW, maxH): { width: number; height: number }`, `readFileAsDataUrl(file): Promise<string>`, `<LibraryDialog manifest store kind onPick onUpload onClose />`; the fully wired `App`.
- Uploads follow the same path as library assets: decode the file, measure it, put `{ dataUrl, width, height }` into the `AssetStore` keyed by the data URL, then dispatch a plain `AssetRef { name, source: dataUrl }`. The ref never carries dimensions (Task 3's rationale).

- [ ] **Step 1: Write the failing test**

`src/ide/upload.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { downscale, measureImage } from './upload'

describe('downscale', () => {
  it('leaves small images alone', () => {
    expect(downscale(100, 80, 480, 360)).toEqual({ width: 100, height: 80 })
  })

  it('fits wide images to the width limit, preserving aspect', () => {
    expect(downscale(960, 360, 480, 360)).toEqual({ width: 480, height: 180 })
  })

  it('fits tall images to the height limit', () => {
    expect(downscale(360, 720, 480, 360)).toEqual({ width: 180, height: 360 })
  })

  it('rounds to whole pixels', () => {
    const r = downscale(1000, 333, 480, 360)
    expect(Number.isInteger(r.width)).toBe(true)
    expect(Number.isInteger(r.height)).toBe(true)
  })
})

describe('measureImage', () => {
  it('resolves the natural size of a loaded image', async () => {
    const loadImage = async () => ({ naturalWidth: 64, naturalHeight: 32 })
    expect(await measureImage('data:image/png;base64,x', loadImage)).toEqual({
      width: 64, height: 32,
    })
  })

  it('rejects when the image cannot be decoded', async () => {
    const loadImage = async () => { throw new Error('bad image') }
    await expect(measureImage('data:nonsense', loadImage)).rejects.toThrow(/bad image/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ide/upload.test.ts`
Expected: FAIL — cannot resolve `./upload`.

- [ ] **Step 3: Write the upload helpers**

`src/ide/upload.ts`:
```ts
export const MAX_COSTUME_WIDTH = 480
export const MAX_COSTUME_HEIGHT = 360

export interface Dimensions {
  width: number
  height: number
}

/** Fit within the stage while preserving aspect ratio. */
export function downscale(
  width: number,
  height: number,
  maxW = MAX_COSTUME_WIDTH,
  maxH = MAX_COSTUME_HEIGHT,
): Dimensions {
  const factor = Math.min(1, maxW / width, maxH / height)
  return { width: Math.round(width * factor), height: Math.round(height * factor) }
}

export async function measureImage(
  dataUrl: string,
  loadImage: (src: string) => Promise<{ naturalWidth: number; naturalHeight: number }> = domLoadImage,
): Promise<Dimensions> {
  const img = await loadImage(dataUrl)
  return { width: img.naturalWidth, height: img.naturalHeight }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function domLoadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That file could not be read as an image.'))
    img.src = src
  })
}
```

- [ ] **Step 4: Write the library dialog**

`src/ide/components/LibraryDialog.tsx`:
```tsx
import type { AssetStore, LibraryEntry, LibraryManifest } from '../library'

interface Props {
  manifest: LibraryManifest
  store: AssetStore
  kind: 'costume' | 'backdrop'
  onPick: (entry: LibraryEntry) => void
  onUpload: (file: File) => void
  onClose: () => void
}

export function LibraryDialog({ manifest, store, kind, onPick, onUpload, onClose }: Props) {
  const entries = manifest.entries.filter(e => e.kind === kind)
  return (
    <div className="drawer">
      <div className="toolbar">
        <h1>Choose a {kind}</h1>
        <button onClick={onClose}>Close</button>
      </div>
      {entries.map(entry => (
        <div className="api-entry" key={entry.id}>
          <img src={store.get(`library:${entry.id}`)?.dataUrl} alt="" width={48} height={48} style={{ objectFit: 'contain' }} />
          <p>{entry.label}</p>
          <button onClick={() => onPick(entry)}>Use this</button>
        </div>
      ))}
      <h3>Or upload your own</h3>
      <input
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
        }}
      />
      <p style={{ fontSize: 12, color: '#6b7280' }}>
        Built-in art is bundled with the app. See public/library/LICENSE.md for credits.
      </p>
    </div>
  )
}
```

- [ ] **Step 5: Wire the App**

`src/ide/components/App.tsx` (replace the whole file):
```tsx
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
```

- [ ] **Step 6: Verify the whole app**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

Then run `npm run dev` and confirm by hand, reporting what you observed:
1. The IDE loads with an empty stage and a `main` tab.
2. "+ Add sprite" → pick Cat → a Cat tab appears with a thumbnail.
3. Paste into the Cat tab:
   ```js
   onStart(async () => {
     await sprite.say("Hello!", 1)
     sprite.goTo(-100, 0)
     await sprite.glide(100, 0, 1)
   })
   onKeyPress("right", () => sprite.changeX(10))
   ```
4. Run → the cat says hello and glides. Click the stage once to give the iframe keyboard focus, then arrow keys move it (keyboard events only reach a focused iframe — mention this in your report if it is not obvious in the UI).
   Also click "Backdrop" → pick Night → Run again → the stage background changes.
5. Break the code (`sprite.move("fast")`) → Run → the console shows `In Cat, line N: \`move\` needs a number…` and the rest of the game keeps running.
6. Stop → the stage clears; Run again → a fresh start.
7. Sound lifecycle (verifies the Task 5 fix): add a sound-playing script, Run, then hit Stop while it is still audible — the sound must cut off immediately, and Run again must not overlap two sounds.
8. Note whether the first sound of a run plays without the user first clicking the stage; browsers may withhold autoplay permission across the iframe boundary. Report what you observe rather than working around it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire the IDE — library loading, Run/Stop, sprite picker, uploads"
```

---

## Done criteria for Plan 2

- `npm test` passes: protocol guards, bridge queueing, project model, library resolver, session (payload→World, issues, dt clamp, stopAll), key mapping, sprite view math and reconciliation, IDE reducer, completions, reference search, upload math.
- `npm run build` emits both `dist/index.html` and `dist/runtime.html`.
- The manual checklist in Task 9 Step 6 passes, and the implementer's report says so explicitly.
- User code never executes in the parent page: no `eval`/`new Function` outside `src/runtime/executor.ts`, and the parent never imports it (type-only imports are fine).
- `src/runtime/**` is unchanged by this plan.

Plan 3 (server + save/load with secret links) will consume: the `Project` type and `version` field, and add a top-bar Save/Load flow around the same in-memory state.
