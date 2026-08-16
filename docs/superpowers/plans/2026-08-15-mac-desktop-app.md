# macOS Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a signed-capable macOS `.app` that opens the deployed playground in its own window, with a kid-facing offline screen and external links routed to the real browser.

**Architecture:** An Electron shell in `desktop/` that loads `https://play.game-grand.workers.dev`. It bundles no client and runs no server — the renderer is a plain sandboxed browser tab pointed at the deployed Worker. The only real logic is two pure functions (is this URL internal? does this load failure deserve the offline page?), which live in their own modules and carry the unit tests; `main.ts` is wiring.

**Tech Stack:** Electron (ESM main process), electron-builder, TypeScript compiled to `desktop/dist/`, vitest for the pure modules, Playwright + macOS `sips`/`iconutil` for icon generation.

**Spec:** [`docs/superpowers/specs/2026-08-15-mac-desktop-app-design.md`](../specs/2026-08-15-mac-desktop-app-design.md)

## Global Constraints

- **Nothing in `src/`, `server/`, `worker/`, `wrangler.jsonc` or `public/_headers` changes.** If a task seems to need it, stop and raise it.
- **`webSecurity` is never disabled**, and no `webPreferences` overrides of Electron's defaults (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`). No preload script, no IPC.
- **No `connect-src` CSP is introduced anywhere.** `docs/TODO.md` records that it would black out the entire Scratch library (`assets.scratch.mit.edu`).
- **Every relative import inside `desktop/` carries a `.js` extension** (`./urlPolicy.js`), including in test files. `desktop/` compiles under `moduleResolution: NodeNext`, which requires the emitted extension; Vite resolves `.js` back to `.ts` so vitest still works. This differs from `src/` (extensionless) and `server/` (`.ts`) — both of those are `noEmit`, `desktop/` is not.
- **`desktop/` emits.** Unlike `server/` and `scripts/`, it is not run as TypeScript by Node's type stripping, so `erasableSyntaxOnly` does not apply there. `scripts/build-desktop-icon.ts` *is* under `tsconfig.server.json` and must obey it (no enums, no parameter properties, no decorators).
- **`appId` is `dev.gamegrand.app`.** It is bound into the code signature and the `userData` path; it must not change after the first signed build.
- **Default app URL is `https://play.game-grand.workers.dev`**, overridable by the `GAME_GRAND_URL` environment variable.
- **Every user-visible string is written for a child**, matching the tone of `src/runtime/errors.ts` and `server/routes.ts`.
- **Commit subjects are lowercase, imperative, `type: summary`.** Comments explain *why*, never restate the code.
- Node ≥ 24. `make help` must keep listing every target.

---

### Task 1: `desktop/` TypeScript setup and the URL policy

The window shows exactly one origin. Everything else belongs in the user's real browser, where they have a URL bar and their own history. This task establishes the directory, its two tsconfigs, and the first pure module.

**Files:**
- Create: `desktop/tsconfig.json` (typecheck, includes tests)
- Create: `desktop/tsconfig.build.json` (emit, excludes tests)
- Create: `desktop/urlPolicy.ts`
- Create: `desktop/urlPolicy.test.ts`
- Modify: `package.json` (add `typecheck:desktop` script)
- Modify: `.gitignore` (add `desktop/dist`)

**Interfaces:**
- Consumes: nothing.
- Produces: `isInternalUrl(url: string, appOrigin: string): boolean` — imported by Task 4's `main.ts` as `./urlPolicy.js`.

- [ ] **Step 1: Create the two tsconfigs**

`desktop/tsconfig.json` — the typecheck config, mirroring how `tsconfig.server.json` is check-only:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"],
  "exclude": ["dist"]
}
```

`desktop/tsconfig.build.json` — the emit config. Tests are excluded so electron-builder never packages them:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "."
  },
  "exclude": ["dist", "**/*.test.ts"]
}
```

- [ ] **Step 2: Write the failing test**

Create `desktop/urlPolicy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isInternalUrl } from './urlPolicy.js'

const APP = 'https://play.game-grand.workers.dev'

describe('isInternalUrl', () => {
  it('keeps the app’s own pages in the window', () => {
    expect(isInternalUrl(APP, APP)).toBe(true)
    expect(isInternalUrl(`${APP}/`, APP)).toBe(true)
  })

  // Secret links are the whole ownership model — opening a saved game must
  // never bounce the kid out to a browser.
  it('keeps /p/<id> secret links in the window', () => {
    expect(isInternalUrl(`${APP}/p/6Kd2nQ1wRt8vZxAbCdEfGh`, APP)).toBe(true)
  })

  it('sends anything on another host to the real browser', () => {
    expect(isInternalUrl('https://scratch.mit.edu/', APP)).toBe(false)
    expect(isInternalUrl('https://example.com/docs', APP)).toBe(false)
  })

  // origin is scheme + host + port, so all three of these are foreign even
  // though the host matches.
  it('treats a different scheme or port as external', () => {
    expect(isInternalUrl('http://play.game-grand.workers.dev/', APP)).toBe(false)
    expect(isInternalUrl('https://play.game-grand.workers.dev:8443/', APP)).toBe(false)
  })

  it('is false for anything that is not a parseable absolute URL', () => {
    for (const bad of ['', '/p/abc', 'not a url', 'about:blank', 'file:///tmp/x.html']) {
      expect(isInternalUrl(bad, APP), bad).toBe(false)
    }
  })

  // GAME_GRAND_URL points the shell at `make dev` during development.
  it('works for a localhost dev origin', () => {
    const dev = 'http://localhost:5173'
    expect(isInternalUrl(`${dev}/p/abc`, dev)).toBe(true)
    expect(isInternalUrl('http://localhost:8080/api/projects', dev)).toBe(false)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run desktop/urlPolicy.test.ts`
Expected: FAIL — cannot resolve `./urlPolicy.js`.

- [ ] **Step 4: Write the implementation**

Create `desktop/urlPolicy.ts`:

```ts
/**
 * The window shows one origin: the deployed playground. A link anywhere else
 * belongs in the user's real browser, which has a URL bar, history and their
 * own extensions — none of which a chrome-less window has.
 *
 * Scratch's CDN is deliberately not special-cased. `assets.scratch.mit.edu` is
 * reached by fetch(), never by navigation, so this is never asked about it.
 */
export function isInternalUrl(url: string, appOrigin: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // A relative or malformed target is not something to hand to the browser.
    return false
  }
  return parsed.origin === appOrigin
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run desktop/urlPolicy.test.ts`
Expected: PASS, 6 tests.

This step is also the load-bearing check on the `.js`-extension convention: the test
imports `./urlPolicy.js` and Vite resolves it back to `urlPolicy.ts`. If instead it fails
with a resolution error, do not switch the source to extensionless imports — that would
break the `NodeNext` emit in Task 4. Add `resolve: { extensions: ['.ts', '.js'] }` to
`vite.config.ts`, or point the test at `./urlPolicy.ts` directly, and note which was needed.

- [ ] **Step 6: Wire the typecheck and gitignore**

Add to `package.json` `scripts`, after `"typecheck:worker"`:

```json
"typecheck:desktop": "tsc -p desktop/tsconfig.json",
```

Append to `.gitignore`:

```
# Compiled Electron main process. desktop/ is the one directory that emits —
# Electron runs its own bundled Node, which cannot be assumed to strip types
# the way `make server` relies on.
desktop/dist/
```

- [ ] **Step 7: Verify the typecheck passes**

Run: `npm run typecheck:desktop`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add desktop/tsconfig.json desktop/tsconfig.build.json desktop/urlPolicy.ts desktop/urlPolicy.test.ts package.json .gitignore
git commit -m "feat: add the desktop url policy"
```

---

### Task 2: The load-failure policy

`did-fail-load` fires far more often than the window is actually broken. Swapping in an error page for an ordinary cancelled navigation, or for a failed subframe, would replace a working IDE with a lie.

**Files:**
- Create: `desktop/loadFailure.ts`
- Create: `desktop/loadFailure.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `shouldShowOfflinePage(event: { isMainFrame: boolean; errorCode: number }): boolean` — imported by Task 4's `main.ts` as `./loadFailure.js`.

- [ ] **Step 1: Write the failing test**

Create `desktop/loadFailure.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shouldShowOfflinePage } from './loadFailure.js'

// Chromium net error codes.
const ABORTED = -3
const INTERNET_DISCONNECTED = -106
const NAME_NOT_RESOLVED = -105

describe('shouldShowOfflinePage', () => {
  it('shows the page when the main frame genuinely fails', () => {
    expect(shouldShowOfflinePage({ isMainFrame: true, errorCode: INTERNET_DISCONNECTED })).toBe(true)
    expect(shouldShowOfflinePage({ isMainFrame: true, errorCode: NAME_NOT_RESOLVED })).toBe(true)
  })

  // A cancelled navigation reports ERR_ABORTED. Treating it as a failure would
  // replace a perfectly good IDE with an error screen.
  it('ignores ERR_ABORTED', () => {
    expect(shouldShowOfflinePage({ isMainFrame: true, errorCode: ABORTED })).toBe(false)
  })

  // The one subframe here is the runtime iframe. A game that cannot load is
  // the running game's problem and the app reports it itself.
  it('ignores subframe failures entirely', () => {
    expect(shouldShowOfflinePage({ isMainFrame: false, errorCode: INTERNET_DISCONNECTED })).toBe(false)
    expect(shouldShowOfflinePage({ isMainFrame: false, errorCode: ABORTED })).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run desktop/loadFailure.test.ts`
Expected: FAIL — cannot resolve `./loadFailure.js`.

- [ ] **Step 3: Write the implementation**

Create `desktop/loadFailure.ts`:

```ts
/** Chromium's ERR_ABORTED — a cancelled navigation, not a fault. */
const ERR_ABORTED = -3

/**
 * `did-fail-load` is noisy: it fires for every subframe and for ordinary
 * cancelled navigations as well as for real failures. Only a main-frame
 * failure that is not a cancellation means the window has nothing to show.
 */
export function shouldShowOfflinePage(event: {
  isMainFrame: boolean
  errorCode: number
}): boolean {
  if (!event.isMainFrame) return false
  return event.errorCode !== ERR_ABORTED
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run desktop/loadFailure.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck:desktop
git add desktop/loadFailure.ts desktop/loadFailure.test.ts
git commit -m "feat: add the desktop load-failure policy"
```

---

### Task 3: The offline page

When the app cannot reach the games, a child sees this. It must load with no network at all, so it carries no remote font, image, or stylesheet — and the test enforces that, because the failure mode is invisible on a developer's machine that always has internet.

**Files:**
- Create: `desktop/offline.html`
- Create: `desktop/offline.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `desktop/offline.html`, loaded by Task 4 via `win.loadFile(..., { query: { url: APP_URL } })`. The page reads `?url=` and navigates there on retry.

- [ ] **Step 1: Write the failing test**

Create `desktop/offline.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('./offline.html', import.meta.url), 'utf8')

describe('offline.html', () => {
  // The whole point of this page is that it renders with no network. A remote
  // font or stylesheet would silently degrade it in exactly the situation it
  // exists for, and nothing on a developer machine would ever show it.
  it('references nothing remote', () => {
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('speaks to a kid about the internet, not about error codes', () => {
    expect(html).toMatch(/internet/i)
    expect(html).not.toMatch(/ERR_|errorCode|net::/)
  })

  // main.ts passes the app URL as a query parameter rather than through a
  // preload bridge — the retry button must read it back.
  it('retries by reading the url query parameter', () => {
    expect(html).toContain('URLSearchParams')
    expect(html).toContain("get('url')")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run desktop/offline.test.ts`
Expected: FAIL — `ENOENT`, no such file `offline.html`.

- [ ] **Step 3: Write the page**

Create `desktop/offline.html`. Colours are lifted from the crest in `public/favicon.svg` (`#12192C` dark, `#F7C433` gold):

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Game Grand</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: grid;
    place-items: center;
    background: #12192C;
    color: #F4F1E8;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
    text-align: center;
    -webkit-user-select: none;
  }
  main { max-width: 30rem; padding: 2rem; }
  h1 { font-size: 1.75rem; margin: 0 0 0.75rem; color: #F7C433; }
  p { margin: 0 0 1.75rem; }
  button {
    font: inherit;
    font-weight: 600;
    color: #12192C;
    background: #F7C433;
    border: 0;
    border-radius: 0.5rem;
    padding: 0.7rem 1.6rem;
    cursor: pointer;
  }
  button:hover { background: #FFE885; }
</style>
</head>
<body>
  <main>
    <h1>I can't find your games</h1>
    <p>
      This app needs the internet to open your games. Check that you're
      connected, then have another go.
    </p>
    <button id="retry" type="button">Try again</button>
  </main>
  <script>
    // main.ts passes the app URL in the query string. There is no preload and
    // no IPC here on purpose: a plain same-origin navigation is all a retry
    // needs, and it keeps this window free of any privileged bridge.
    const target = new URLSearchParams(location.search).get('url')
    document.getElementById('retry').addEventListener('click', () => {
      if (target) location.href = target
    })
  </script>
</body>
</html>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run desktop/offline.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/offline.html desktop/offline.test.ts
git commit -m "feat: add a kid-facing offline page for the desktop app"
```

---

### Task 4: The Electron main process

This is the task that produces something you can look at. Everything before it was pure functions; this wires them into a window.

**Files:**
- Create: `desktop/main.ts`
- Modify: `package.json` (add `main` field, Electron devDependencies, `desktop:*` scripts)
- Modify: `Makefile` (add `desktop-dev`, `desktop-build`; extend `.PHONY` and `clean`)

**Interfaces:**
- Consumes: `isInternalUrl(url, appOrigin)` from `./urlPolicy.js`; `shouldShowOfflinePage({ isMainFrame, errorCode })` from `./loadFailure.js`; `desktop/offline.html`.
- Produces: `desktop/dist/main.js`, the packaged app's entry point in Task 6.

- [ ] **Step 1: Install Electron**

```bash
npm install --save-dev electron electron-builder
```

Then confirm the installed Electron is 28 or newer — ESM main processes are unsupported before that, and this plan emits ESM because the root `package.json` sets `"type": "module"`:

```bash
node -p "require('./node_modules/electron/package.json').version"
```

Expected: a version ≥ 28. If it is older, stop and raise it.

- [ ] **Step 2: Add the entry point and scripts to `package.json`**

Add a top-level `"main"` field (below `"license"`), which is how both Electron and electron-builder find the entry:

```json
"main": "desktop/dist/main.js",
```

Add to `scripts`:

```json
"desktop:build": "tsc -p desktop/tsconfig.build.json && cp desktop/offline.html desktop/dist/",
"desktop": "electron .",
```

`offline.html` is copied beside `main.js` so packaging has one directory to include.

- [ ] **Step 3: Write the main process**

Create `desktop/main.ts`:

```ts
import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { isInternalUrl } from './urlPolicy.js'
import { shouldShowOfflinePage } from './loadFailure.js'

// The app ships no client bundle: it points at the deployed Worker, so a
// Cloudflare deploy updates every installed copy. GAME_GRAND_URL aims it at
// `make dev` or `make worker-dev` instead.
const APP_URL = process.env.GAME_GRAND_URL ?? 'https://play.game-grand.workers.dev'
const APP_ORIGIN = new URL(APP_URL).origin
const OFFLINE_PAGE = fileURLToPath(new URL('./offline.html', import.meta.url))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // The IDE is a stage-and-editor split; below this it stops being usable.
    minWidth: 1024,
    minHeight: 700,
    title: 'Game Grand',
    // Matches the crest's dark, so launching does not flash white.
    backgroundColor: '#12192C',
    // No webPreferences on purpose. The renderer loads remote content, so it
    // gets Electron's defaults and nothing more: contextIsolation on,
    // nodeIntegration off, sandbox on, no preload, no IPC.
    //
    // webSecurity must never be turned off here. This codebase talks about
    // CORS constantly, which makes it a tempting-looking fix for any loading
    // problem — and it would dissolve the opaque-origin iframe that keeps
    // user code out of the app's realm.
  })

  // window.open and target="_blank". The IDE has no popups of its own, so
  // every one of these is an outbound link.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternalUrl(url, APP_ORIGIN)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    // Same-origin navigation covers /p/<id> and the offline page's retry.
    if (isInternalUrl(url, APP_ORIGIN)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  win.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (!shouldShowOfflinePage({ isMainFrame, errorCode })) return
    void win.loadFile(OFFLINE_PAGE, { query: { url: APP_URL } })
  })

  void win.loadURL(APP_URL)
}

// Electron's default menu is kept deliberately. Trimming it is the obvious way
// to make a wrapper feel native, and on macOS it silently breaks Monaco: Cmd+C
// and Cmd+V in the editor are delivered through the Edit menu's roles.

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS apps conventionally stay in the Dock with no windows open.
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 4: Add the Makefile targets**

Add `desktop-build` and `desktop-dev` to `.PHONY` on line 8, then append these targets before `clean`:

```make
desktop-build: node_modules ## Compile the Electron main process to desktop/dist/
	npm run desktop:build

# Points at the deployed Worker by default. Override to develop against a
# local server: GAME_GRAND_URL=http://localhost:$(DEV_PORT) make desktop-dev
desktop-dev: desktop-build ## Run the Mac app shell
	npm run desktop
```

Extend the `clean` target to drop the compiled output:

```make
clean: ## Remove build output and test artifacts
	rm -rf dist test-results playwright-report desktop/dist
```

- [ ] **Step 5: Typecheck, build and launch**

```bash
npm run typecheck:desktop
make desktop-dev
```

Expected: a window titled "Game Grand" opens showing the live playground — stage on the left, Monaco on the right. Confirm all four by hand:

1. The stage is **not blank** — press Run on the starter project and watch a sprite move. A blank stage means the CORS/opaque-origin path broke.
2. Copy and paste work in the editor (`Cmd+C`, `Cmd+V`), proving the default menu survived.
3. Quit, then run with a URL that cannot resolve and confirm the offline page appears with working retry copy:
   `GAME_GRAND_URL=https://not-a-real-host.invalid npm run desktop`
4. Reconnect the real URL and confirm normal loading again.

- [ ] **Step 6: Verify the offline page's retry path**

With the app running against the unreachable host from the previous step, click **Try again**. Expected: it re-attempts and returns to the offline page (not a blank window, not a Chromium error page). This proves `loadFile`'s `query` reached the page and `will-navigate` allowed the same-origin retry.

- [ ] **Step 7: Run the full unit suite**

Run: `make test-unit`
Expected: PASS — the existing suite plus the 12 new desktop tests.

- [ ] **Step 8: Commit**

```bash
git add desktop/main.ts package.json package-lock.json Makefile
git commit -m "feat: add an electron shell for the deployed playground"
```

---

### Task 5: The app icon

`public/favicon.svg` is a crest on transparency. Rendered bare it would be a floating shape in a Dock full of rounded squares, so the script insets it in a rounded rectangle the way macOS icons have been since Big Sur.

**Files:**
- Create: `scripts/build-desktop-icon.ts`
- Modify: `Makefile` (add `desktop-icon`, make `desktop-build` depend on it)
- Modify: `.gitignore` (add `desktop/icon.icns`, `desktop/icon.iconset/`)

**Interfaces:**
- Consumes: `public/favicon.svg`.
- Produces: `desktop/icon.icns`, referenced by Task 6's electron-builder config.

- [ ] **Step 1: Write the generator**

Create `scripts/build-desktop-icon.ts`. It is under `tsconfig.server.json`, so it runs as TypeScript via Node's type stripping and must stay within `erasableSyntaxOnly` — plain functions and type annotations only:

```ts
import { chromium } from '@playwright/test'
import { mkdir, rm, readFile, copyFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const SVG = 'public/favicon.svg'
const ICONSET = 'desktop/icon.iconset'
const ICNS = 'desktop/icon.icns'

// The ten entries iconutil expects. Rendered once at 1024 and downscaled by
// sips, rather than re-rendered per size: one render is the reference, and
// every smaller icon is a resample of exactly the same artwork.
const MASTER = 'icon_512x512@2x.png'
const DOWNSCALES: Array<{ name: string; size: number }> = [
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_16x16.png', size: 16 },
]

function page(svg: string): string {
  // Fixed pixel units because the viewport is always 1024. The tile is the
  // macOS rounded-rect grid: artwork inset, not full-bleed.
  return `<!doctype html>
<style>
  html, body { margin: 0; width: 1024px; height: 1024px; }
  body { display: grid; place-items: center; }
  .tile {
    width: 840px; height: 840px;
    border-radius: 188px;
    background: linear-gradient(160deg, #F7F3E6 0%, #E4D9BC 100%);
    display: grid; place-items: center;
    box-shadow: 0 12px 28px rgba(18, 25, 44, 0.25);
  }
  .tile svg { width: 660px; height: 660px; }
</style>
<div class="tile">${svg}</div>`
}

const svg = await readFile(SVG, 'utf8')

await rm(ICONSET, { recursive: true, force: true })
await mkdir(ICONSET, { recursive: true })

const browser = await chromium.launch()
const tab = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await tab.setContent(page(svg))
// omitBackground keeps the corners outside the rounded rect transparent.
await tab.screenshot({ path: `${ICONSET}/${MASTER}`, omitBackground: true })
await browser.close()

for (const entry of DOWNSCALES) {
  await copyFile(`${ICONSET}/${MASTER}`, `${ICONSET}/${entry.name}`)
  await run('sips', ['-z', String(entry.size), String(entry.size), `${ICONSET}/${entry.name}`])
}

await run('iconutil', ['-c', 'icns', ICONSET, '-o', ICNS])

console.log(`Wrote ${ICNS}`)
```

- [ ] **Step 2: Wire it into the Makefile**

Add `desktop-icon` to `.PHONY`, then add this target above `desktop-build` and make `desktop-build` depend on it:

```make
# Generated, never committed — public/favicon.svg is the single source. Needs
# Playwright's chromium (`npx playwright install chromium`); sips and iconutil
# ship with macOS.
desktop/icon.icns: public/favicon.svg scripts/build-desktop-icon.ts | node_modules
	node scripts/build-desktop-icon.ts

desktop-icon: desktop/icon.icns ## Generate the Mac app icon from public/favicon.svg

desktop-build: node_modules desktop/icon.icns ## Compile the Electron main process to desktop/dist/
	npm run desktop:build
```

Extend `clean`:

```make
clean: ## Remove build output and test artifacts
	rm -rf dist test-results playwright-report desktop/dist desktop/icon.icns desktop/icon.iconset
```

- [ ] **Step 3: Ignore the generated files**

Append to `.gitignore`:

```
# Generated by `make desktop-icon` from public/favicon.svg, which is the
# single source for the crest.
desktop/icon.icns
desktop/icon.iconset/
```

- [ ] **Step 4: Generate and inspect the icon**

```bash
make desktop-icon
open desktop/icon.iconset/icon_512x512@2x.png
```

Expected: a rounded-rect tile with the crest inset and transparent corners. Then check the small end, where inset artwork most often turns to mud:

```bash
open desktop/icon.iconset/icon_16x16.png
```

If the crest is unreadable at 16px, widen `.tile svg` toward 720px and regenerate — legibility at 16 beats fidelity at 1024.

- [ ] **Step 5: Confirm the app picks it up**

```bash
make desktop-dev
```

Expected: the Dock icon during development is still Electron's default — icons only apply to packaged builds, which Task 6 produces. Confirm only that `desktop/icon.icns` exists and `make desktop-build` succeeds:

```bash
ls -la desktop/icon.icns
```

- [ ] **Step 6: Commit**

```bash
git add scripts/build-desktop-icon.ts Makefile .gitignore
git commit -m "build: generate the mac app icon from the crest"
```

---

### Task 6: Packaging and signing

**Files:**
- Create: `desktop/electron-builder.yml`
- Modify: `package.json` (add `desktop:dist` script)
- Modify: `Makefile` (add `desktop-dist`, `desktop-dist-signed`)
- Modify: `.gitignore` (add `release/`)

**Interfaces:**
- Consumes: `desktop/dist/main.js`, `desktop/dist/offline.html`, `desktop/icon.icns`, `package.json`'s `main` field.
- Produces: `release/Game Grand-<version>.dmg`.

- [ ] **Step 1: Write the builder config**

Create `desktop/electron-builder.yml`:

```yaml
appId: dev.gamegrand.app
productName: Game Grand
directories:
  output: release

# The app is a shell around a deployed URL: it needs its own compiled main
# process and nothing else. Without the node_modules exclusion, electron-builder
# packages every production dependency — react, phaser, monaco, fastify — none
# of which this process ever imports.
files:
  - package.json
  - desktop/dist/**/*
  - '!node_modules/**/*'

mac:
  category: public.app-category.education
  icon: desktop/icon.icns
  target:
    - dmg
  # Required for notarization.
  hardenedRuntime: true
  gatekeeperAssess: false
  # Overridden to true by `make desktop-dist-signed`, so an unsigned local
  # build stays possible with no Apple credentials present.
  notarize: false
```

- [ ] **Step 2: Add the scripts and targets**

Add to `package.json` `scripts`:

```json
"desktop:dist": "electron-builder --config desktop/electron-builder.yml",
```

Add `desktop-dist` and `desktop-dist-signed` to `.PHONY`, and append these targets:

```make
desktop-dist: desktop-build ## Package an unsigned .dmg into release/
	npm run desktop:dist

# Needs a Developer ID Application certificate plus APPLE_ID,
# APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID in the environment. Recent
# macOS removed the Control-click bypass for unnotarized apps, so an unsigned
# build is only usable on the machine that made it.
desktop-dist-signed: desktop-build ## Package a signed, notarized .dmg
	npm run desktop:dist -- --config.mac.notarize=true
```

Append to `.gitignore`:

```
# electron-builder output.
release/
```

- [ ] **Step 3: Build the unsigned package**

```bash
make desktop-dist
```

Expected: `release/Game Grand-0.1.0.dmg` and `release/mac-arm64/Game Grand.app` (or `mac/` on Intel).

- [ ] **Step 4: Verify the bundle contains nothing it shouldn't**

The `files` exclusion above is the one part of this config that fails silently — a mistake there produces a working app that is simply 100 MB fatter:

```bash
npx asar list "release/mac-arm64/Game Grand.app/Contents/Resources/app.asar" | grep -c node_modules
```

Expected: `0`. If it is not zero, the `!node_modules/**/*` pattern is not taking effect — fix it before continuing.

Then confirm no test files shipped:

```bash
npx asar list "release/mac-arm64/Game Grand.app/Contents/Resources/app.asar" | grep -c '\.test\.'
```

Expected: `0`.

- [ ] **Step 5: Run the packaged app**

```bash
open "release/mac-arm64/Game Grand.app"
```

Expected: the crest icon in the Dock, a window titled "Game Grand", the live playground, and a stage that runs a project. This is the first point where the icon is actually verifiable.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron-builder.yml package.json Makefile .gitignore
git commit -m "build: package the desktop app as a dmg"
```

---

### Task 7: Documentation

The repo's conventions require this: `CLAUDE.md` and `README.md` both describe the entry points and commands, and `docs/TODO.md` is the live register of deferred work.

**Files:**
- Modify: `CLAUDE.md` (entry-point table, commands, layer map)
- Modify: `README.md` (a Desktop app section after Deploying)
- Modify: `docs/TODO.md` (a new deferred section)

- [ ] **Step 1: Record the deferred work in `docs/TODO.md`**

Add this section after the "Cloudflare deployment follow-ups" section. The first entry is the one that gates use, so it leads:

```markdown
## Mac desktop app follow-ups

- [ ] **A closed window can lose a game forever — do not hand this build to a classroom yet.** There are no accounts: a project id *is* the capability, and `/p/<id>` in the address bar is the whole ownership model. A browser keeps that link in history, bookmarks and autocomplete; the desktop window has none of those and no address bar to copy from. The fix is a native Games menu backed by ids recorded to Electron's `userData` as the user navigates, plus "Copy link to this game". Designed and deliberately deferred in `docs/superpowers/specs/2026-08-15-mac-desktop-app-design.md`.
- [ ] The app is pinned to whatever is deployed. Shipping no client bundle means a Cloudflare deploy updates every installed copy for free — and equally that a bad deploy breaks every installed copy, with no way to pin or roll back locally.
- [ ] No auto-update. Changing the shell itself (the offline page, the navigation policy) means redistributing the `.dmg` by hand. `electron-updater` would fix it and needs a hosting decision.
- [ ] No Electron e2e mode. `desktop/urlPolicy.ts` and `desktop/loadFailure.ts` are unit-tested, but nothing automatically verifies that the packaged app opens a window, loads the URL and renders a stage. Playwright's `_electron.launch()` would do it, at the cost of a fifth e2e mode with its own dependency on something being served.
- [ ] Window bounds are not remembered between launches.
- [ ] The desktop title bar is the macOS default rather than `hiddenInset`, because the traffic lights would land on the IDE's own top bar. Making it native means desktop-conditional padding inside `src/`, which the desktop work deliberately avoided.
```

- [ ] **Step 2: Update `CLAUDE.md`'s entry-point table**

Add a fourth row to the table under "Architecture":

```markdown
| `desktop/main.ts` | `desktop/**` | The Electron shell around the deployed URL |
```

- [ ] **Step 3: Update `CLAUDE.md`'s commands section**

Add to the `make help` command block, after `make server-dev`:

```bash
make desktop-dev      # Electron shell on the deployed URL; GAME_GRAND_URL overrides it
make desktop-dist     # package an unsigned .dmg into release/
```

- [ ] **Step 4: Update `CLAUDE.md`'s layer map**

Add after the `server/` bullet:

```markdown
- `desktop/` — the Electron shell. It bundles no client and runs no server: it opens the deployed Worker URL in a `BrowserWindow`. `urlPolicy.ts` decides what stays in the window versus what goes to the real browser, `loadFailure.ts` decides which `did-fail-load` events deserve `offline.html`; `main.ts` is wiring around those two. It is the one directory that **emits** JavaScript (`desktop/tsconfig.build.json` → `desktop/dist/`), because Electron runs its own bundled Node and cannot be assumed to strip types — so relative imports there carry `.js` extensions, not `.ts`.
```

- [ ] **Step 5: Add the README section**

Insert a `## Desktop app` section between `## Deploying` and `## Licensing`:

```markdown
## Desktop app

`desktop/` is an Electron shell that opens the deployed playground in its own window. It
bundles no client and runs no server — it points at the Worker, so a `make deploy` updates
every installed copy.

```bash
make desktop-dev     # run the shell against the deployed URL
make desktop-dist    # package an unsigned .dmg into release/
```

`GAME_GRAND_URL` aims it somewhere else — `GAME_GRAND_URL=http://localhost:5173 make
desktop-dev` develops against `make dev`.

It cannot load the client from disk. The stage runs in `<iframe sandbox="allow-scripts">`,
which gives it an opaque origin, and module scripts are always fetched in CORS mode — off
`file://` there is no origin to send `Access-Control-Allow-Origin: *` from, so the stage
stays silently blank. The desktop app speaks `https://` for the same reason the Worker sets
`_headers`.

**Handing it to someone else needs signing.** Recent macOS removed the Control-click → Open
bypass for unnotarized apps, and AirDrop sets the quarantine flag too, so an unsigned build
is realistically only usable on the machine that made it. With a Developer ID Application
certificate and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` in the
environment:

```bash
make desktop-dist-signed
```

**One caveat before giving this to a classroom**, recorded in [`docs/TODO.md`](docs/TODO.md):
there are no accounts, so `/p/<id>` in the address bar is the entire ownership model. A
browser keeps that link in history and bookmarks; this window has neither, so a kid who
closes it has lost that game. A native Games menu is designed and deferred.
```

- [ ] **Step 6: Verify the docs are accurate**

```bash
make help
```

Expected: `desktop-dev`, `desktop-build`, `desktop-icon`, `desktop-dist` and `desktop-dist-signed` all listed with their descriptions. Every command quoted in the README and `CLAUDE.md` must appear here.

- [ ] **Step 7: Full verification**

```bash
npm run typecheck:desktop
make test-unit
make build
```

Expected: all three pass. `make build` proves the desktop work did not disturb the client or server typechecks.

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md README.md docs/TODO.md
git commit -m "docs: document the mac desktop app and its deferred work"
```

---

## Verification checklist

Run before opening a PR:

- [ ] `npm run typecheck:desktop` — clean
- [ ] `make test-unit` — passes, including 12 new desktop tests
- [ ] `make build` — client and server typechecks unaffected
- [ ] `make desktop-dist` then open the packaged `.app` — crest icon, window opens, **a project actually runs on the stage**
- [ ] `GAME_GRAND_URL=https://not-a-real-host.invalid npm run desktop` — offline page, working Try again
- [ ] `Cmd+C` / `Cmd+V` work inside Monaco in the packaged app
- [ ] An external link in the API reference opens in the real browser, not in the app window
- [ ] `npx asar list` on the packaged app shows no `node_modules` and no `.test.` files
- [ ] `git status` clean — no `desktop/dist`, `desktop/icon.icns`, `desktop/icon.iconset` or `release/` tracked
