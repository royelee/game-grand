# A Mac desktop app — Design

**Date:** 2026-08-15
**Status:** Approved by user (clarification session)

## What we're building

A signed, notarizable macOS application that opens the deployed playground in its own
window. It is a shell: an Electron main process, a kid-facing offline screen, an icon, and
a packaging pipeline. It ships no application code of its own.

The app points at `https://play.game-grand.workers.dev` — the Worker deployed by
`wrangler.jsonc`. It does not bundle `dist/`, does not run `server/`, and does not carry a
copy of the IDE.

## What this is not

Three things were considered and rejected, and the reasons are worth keeping because each
looks attractive from a distance.

**Not an offline app.** A local-first build would bundle the client and run `server/` (or
an equivalent) inside the app, saving games to a SQLite file on the Mac. That is a
materially larger project — a second storage backend, a second save destination to explain
to a child, and no secret links that work across devices. Ruled out for this version.

**Not a `file://` bundle.** Even the online-only shell cannot load `dist/index.html` from
disk. The stage runs in `<iframe sandbox="allow-scripts">`, which gives it an opaque
origin, and module scripts are always fetched in CORS mode. Off `file://` there is no
origin to send `Access-Control-Allow-Origin: *` from, so the iframe cannot load its own
bundle and the stage stays silently blank — the same failure `docs/TODO.md` records as
having been caught by e2e rather than by review. Any desktop build must speak `http(s)://`.

**Not Tauri, and not a hand-written `WKWebView` host.** Both produce a ~10 MB app instead
of ~200 MB, which buys nothing at this distribution scale. Both also run the app on
WebKit, and the one behaviour this app depends on most — a sandboxed, opaque-origin iframe
CORS-fetching its own module bundle — is precisely the kind of edge where engines differ.
Electron ships the same Chromium that `make test-e2e` already exercises, and adds no
toolchain that is not already a devDependency. Tauri would additionally put a Rust
toolchain in the path of every contributor and every CI runner.

## Decisions made

| Decision | Choice |
|---|---|
| Wrapper | Electron, packaged with `electron-builder` |
| Content | The deployed Worker URL. No bundled `dist/`, no bundled server |
| Location | `desktop/`, a third deployment target beside `server/` and `worker/` |
| TypeScript | `desktop/` **emits** to `desktop/dist/` — it does not run `.ts` directly |
| Preload / IPC | **None.** Electron's secure defaults, untouched |
| Title bar | Default. Not `hiddenInset` |
| Menu | Electron's default menu, kept |
| Offline behaviour | Local `offline.html`, written for a child |
| External links | `shell.openExternal`; in-app navigation is same-origin only |
| Games menu (link recovery) | **Deferred.** Recorded in `docs/TODO.md` with its consequence |
| Auto-update | Deferred |
| Icon | Generated from `public/favicon.svg`, not committed |

## Architecture

```
  ┌───────────────── Game Grand.app ─────────────────┐
  │                                                   │
  │  main process (desktop/dist/main.js)              │
  │    ├── BrowserWindow 1280×800, min 1024×700       │
  │    ├── setWindowOpenHandler ─┐                    │
  │    ├── will-navigate ────────┴─→ urlPolicy.ts     │
  │    │      same origin → allow                     │
  │    │      otherwise   → shell.openExternal        │
  │    ├── did-fail-load ────────→ loadFailure.ts     │
  │    │      main frame, not -3 → offline.html       │
  │    └── default application menu                   │
  │                                                   │
  │  renderer (no preload, no node, sandboxed)        │
  │    └── https://play.game-grand.workers.dev        │
  │          └── <iframe sandbox> → /runtime.html     │
  │          └── fetch → assets.scratch.mit.edu       │
  └───────────────────────────────────────────────────┘
```

Everything below the renderer line is the existing app, unchanged and unaware it is in a
desktop window.

## The main process

### Security posture

The renderer loads remote content, so it gets no privileges: no preload script, no IPC
channel, and every Electron default left alone — `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`. The renderer is a browser tab.

**`webSecurity` must never be disabled.** This codebase talks about CORS constantly, which
makes `webSecurity: false` a tempting-looking fix for any loading problem. It would
dissolve the opaque-origin boundary that keeps user code out of the app's realm — the
central design fact of the whole project.

### Window

1280×800 default, minimum 1024×700 — the IDE is a two-pane stage-and-editor layout and
stops being usable narrower than that.

The title bar stays default. `titleBarStyle: 'hiddenInset'` is the obvious move for making
a wrapper feel native, and here the traffic lights would land on top of the IDE's own top
bar. Fixing that means adding desktop-conditional padding inside `src/`, and this change
does not touch `src/`.

Window bounds are not persisted. It is a small amount of code, but nothing asked for it.

### Navigation policy — `desktop/urlPolicy.ts`

One pure function decides whether a URL belongs in the app window or in the user's real
browser: `new URL(url).origin === APP_ORIGIN`. `setWindowOpenHandler` covers
`window.open` and `target="_blank"`; `will-navigate` covers everything else. Anything
external is denied and handed to `shell.openExternal`.

Two behaviours this must preserve:

- **`/p/<id>` navigation stays in the app.** Secret links are same-origin, so opening a
  saved game is an ordinary allowed navigation.
- **Scratch CDN traffic is untouched.** `assets.scratch.mit.edu` is reached by `fetch`,
  not by navigation, so neither handler sees it. Relatedly, and for the reason already
  recorded at `docs/TODO.md`: a `connect-src` CSP must not be introduced here, or the
  entire Scratch library goes dark.

The app origin is baked in, with a `GAME_GRAND_URL` environment override so the shell can
be pointed at `make dev` or `wrangler dev` during development.

### Failed loads — `desktop/loadFailure.ts`

`did-fail-load` fires for subframes and for ordinary cancelled navigations as well as for
real failures, so a second pure function decides what deserves the offline screen: main
frame only, and never error code `-3` (`ERR_ABORTED`), which is a normal navigation
cancellation rather than a fault. Subframe failures are ignored deliberately — a
`runtime.html` that fails to load is the running game's problem, and the app already has
its own reporting for that.

When the filter passes, the window loads `offline.html`, a self-contained local page with
no remote fonts or assets. Its copy is written for a child, in the register of
`server/routes.ts` and `src/runtime/errors.ts` — the app tells a kid it cannot reach the
games right now and asks them to check their internet, rather than showing Chromium's grey
error page.

Its "Try again" button sets `location.href` to the app origin. That is a same-origin
navigation as far as the policy above is concerned, so retry works with no IPC, no
preload, and no privileged bridge. If it fails again, `did-fail-load` simply puts the same
page back.

### Menu

Electron's default menu is kept.

This is a real decision, not laziness. Replacing it with a minimal custom menu is the
natural "make it feel like an app" instinct, and on macOS it silently breaks Monaco:
`Cmd+C` and `Cmd+V` in the editor are delivered through the Edit menu's `copy` and `paste`
roles. A menu without them produces an editor a kid cannot paste into.

## TypeScript in `desktop/`

`desktop/tsconfig.json` emits to `desktop/dist/`. This is a deliberate departure from
`server/` and `scripts/`, which are `noEmit` and run as TypeScript under Node 24's type
stripping — the reason `tsconfig.server.json` sets `erasableSyntaxOnly`.

Electron runs its own bundled Node, whose version this project does not control and which
cannot be assumed to strip types. Compiling removes the question entirely, and
`erasableSyntaxOnly` does not apply to `desktop/`.

`desktop/offline.html` is copied into `desktop/dist/` by the build, so packaging has a
single directory to include and `main.js` can resolve the page beside itself.

## The icon

`scripts/build-desktop-icon.ts` renders `public/favicon.svg` into the ten PNGs an
`.iconset` requires (16, 32, 128, 256 and 512 points, each at 1× and 2×) and runs
`iconutil` to produce `desktop/icon.icns`.

The crest is drawn on transparency. macOS app icons since Big Sur are artwork inset in a
rounded rectangle, so the script composes the crest onto that shape rather than rendering
it bare — a floating crest reads as foreign next to every other icon in the Dock.

Playwright is already a devDependency and rasterizes the SVG at arbitrary sizes, so this
adds no image toolchain. `iconutil` is macOS-only, which is not a constraint for a macOS
app.

The `.icns` and the intermediate `.iconset` are generated and gitignored, matching the
arrangement `make catalog` already uses for `public/library/scratch-catalog.json`.

## Build and distribution

`electron-builder` produces a `.dmg` into a gitignored `release/`. `productName` is
"Game Grand", the category is `public.app-category.education`, and `appId` is
`dev.gamegrand.app` — it is bound into the signature and the app's `userData` path, so it
must be settled before the first signed build and never changed after.

Because the app carries no client bundle, `make build` is **not** a prerequisite of the
desktop build. The desktop target depends only on compiling `desktop/` and generating the
icon.

Makefile targets, following the existing naming:

- `make desktop-dev` — compile and launch the shell, honouring `GAME_GRAND_URL`
- `make desktop-build` — compile `desktop/` and generate the icon
- `make desktop-dist` — the above, then `electron-builder` → `.dmg`

`desktop/dist/`, `desktop/icon.icns`, `desktop/icon.iconset/` and the builder's output
directory are gitignored.

### Signing is not optional in practice

`hardenedRuntime: true` is set, and notarization is gated on credentials being present in
the environment, so an unsigned local build still runs on the machine that made it.

For the actual goal — handing this to a few other Macs — signing and notarization are
required, not a polish step. Recent macOS releases removed the Control-click → Open bypass
for unnotarized applications, and the quarantine flag is applied by AirDrop as well as by
downloads. Without a Developer ID Application certificate, every recipient must either
visit System Settings → Privacy & Security → Open Anyway, or run `xattr -d` in Terminal.
Neither is something to ask of a family member or a classroom.

That means enrolment in the Apple Developer Program (currently $99/year), a Developer ID
Application certificate, and notarization credentials supplied to the build through the
environment. Credentials are never committed — the same rule the Cloudflare deploy
established for `.env`.

## Testing

The shell's two decisions are pure functions, and they are where the bugs would be:
`urlPolicy.ts` (does this URL stay in the app?) and `loadFailure.ts` (does this failure
deserve the offline screen?). Both are plain modules with no Electron import, unit-tested
by `vitest` in the existing node environment.

This follows the convention the project already applies to `store.ts` and
`completions.ts`: logic that needs testing is lifted out of the shell that cannot be
tested, rather than reaching for a new runner. What remains in `main.ts` is wiring — window
options and event registrations — with no branching worth asserting.

A Playwright `_electron.launch()` smoke test would exercise the real window, but it would
be a fifth e2e mode with its own launch path and its own dependency on something being
deployed or served. Deferred.

## What does not change

- `src/`, `server/`, `worker/`, `wrangler.jsonc`, `public/_headers`. The app does not learn
  it is running in a desktop window.
- Every kid-facing message in the existing app. `offline.html` adds one new message, in the
  same voice.
- The save document, the secret-link model, and the API.
- All four existing e2e modes.

## Deferred — to be recorded in `docs/TODO.md` with the implementation

- **The Games menu, and why it gates classroom use.** There are no accounts: a project id
  *is* the capability, and `/p/<id>` in the address bar is the entire ownership model. A
  browser preserves that link in history, bookmarks and autocomplete. A chrome-less window
  has none of those, so a kid who closes the window has permanently lost that game. The fix
  is a native Games menu backed by ids recorded to Electron's `userData` as the user
  navigates, plus "Copy link to this game". **This build should not be handed to a
  classroom until that ships.**
- **The app is pinned to whatever is deployed.** Shipping no bundle means a Cloudflare
  deploy updates every installed copy for free, and equally that a bad deploy breaks every
  installed copy with no way to pin or roll back a version locally.
- **No auto-update.** A change to the shell itself — the offline page, the navigation
  policy — requires redistributing the `.dmg` by hand. `electron-updater` would fix it, and
  needs a hosting decision.
- **No Electron e2e mode.** Nothing automatically verifies that the packaged app opens a
  window, loads the URL, and renders a stage.
- **Window bounds are not remembered** between launches.
