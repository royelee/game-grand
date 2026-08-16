# Game Grand

[![CI](https://github.com/royelee/game-grand/actions/workflows/ci.yml/badge.svg)](https://github.com/royelee/game-grand/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A web playground where kids write **JavaScript** instead of dragging Scratch blocks.

Stage on the left, [Monaco](https://microsoft.github.io/monaco-editor/) editor on the right.
Sprites, costumes, backdrops, sounds, a green-flag Run button — the whole Scratch mental
model — but the scripts are real code. Games save to a server and reopen anywhere from a
secret link, with no account to create.

```js
// the Cat's script
onStart(async () => {
  sprite.goTo(0, 0)
  await sprite.say("Let's draw!", 2)
  sprite.penDown()
})

onUpdate(() => {
  sprite.move(5)
  sprite.turnRight(10)
  sprite.changePen({ color: 2 })   // rainbow spiral
})

onKeyPress('space', () => eraseAll())
```

## Why it looks like this

The audience is beginners, so every design choice favors forgiveness and clarity over
power:

- **User code runs in a sandboxed iframe**, and Stop unmounts it. A kid can write
  `while (true)` and always escape. Every Run is a clean-slate restart, exactly like
  Scratch's green flag.
- **One rule about time**: anything that takes a while (`glide`, `wait`, timed `say`,
  `playSoundUntilDone`) returns a Promise, so you `await` it. Taught once, and sequential
  code reads like a Scratch stack.
- **Errors are written for children.** `move` given a string says
  `move needs a number, like sprite.move(10) — you gave it "fast"`, tagged with the sprite
  name and line number in the console pane. Server errors and refusals are written the
  same way.
- **Phaser is invisible.** The saved format and the docs never mention it, so the renderer
  can be replaced without breaking a single saved game.

The full rationale lives in
[`docs/superpowers/specs/2026-08-08-game-playground-design.md`](docs/superpowers/specs/2026-08-08-game-playground-design.md).

## Quick start

Node ≥ 24 is required — the server runs TypeScript directly via Node's type stripping.

```bash
make install
make build          # needed once, so the server has a dist/ to serve
make server-dev     # Fastify API on :8080  — leave running
make dev            # Vite dev server on :5173 — in a second shell
```

Open <http://localhost:5173>. `make dev` alone gives a working IDE with **broken
Save/Load**: `vite.config.ts` proxies `/api` to `:8080` and nothing starts that process for
you. This foot-gun is a known open item in [`docs/TODO.md`](docs/TODO.md).

For a single-process production server instead:

```bash
make server         # builds the client, then serves dist/ + the API on :8080
```

`PORT`, `HOST`, and `DB_FILE` (default `projects.db`) are the only environment knobs.

`make help` lists every target.

## Tests

```bash
make test-unit        # vitest — 385 tests across 39 files, sub-second
make test-e2e         # Playwright against the dev server
make test-e2e-prod    # E2E_PREVIEW=1 — the production bundle is a different code path
make test-e2e-server  # E2E_SERVER=1 — real Fastify + disposable SQLite; runs the save/load specs
make test-e2e-worker  # E2E_WORKER=1 — the real Cloudflare Worker via `wrangler dev` against
                      #                a local D1. No Cloudflare account needed. The only mode
                      #                covering the _headers rules and the /p/<id> fallback.
make test-all
```

Single tests:

```bash
npx vitest run src/runtime/world.test.ts
npx vitest run -t 'glide resolves'
npx playwright test e2e/ide.spec.ts -g 'clone'
E2E_SERVER=1 npx playwright test e2e/save-load.spec.ts
```

CI runs all of it on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): typecheck and the unit suite in
one job, then the four e2e modes as a parallel matrix. Two notes if you touch it — the
Scratch catalog is cached on the generator's hash so runs don't hammer
`raw.githubusercontent.com`, and Playwright retries **only** under CI, because
`adds a Scratch sprite with its whole costume set` really does download from
`assets.scratch.mit.edu`. Locally retries stay off, where a retry would hide a real flake.

Vitest runs in the **node** environment — no jsdom, no React component tests. Logic that
needs testing is deliberately pulled out of components into plain modules (`store.ts`,
`references.ts`, `catalogSearch.ts`, `completions.ts`). Playwright owns anything involving
the real iframe, Monaco, or a browser, and it has caught bugs the unit tests structurally
cannot — see the CORS note below.

## Architecture

Four entry points, one shared vocabulary. The last two are the same API: `server/` and
`worker/` are thin adapters over `src/shared/api.ts`, so the development and production
deployments cannot answer a request differently.

| Entry | Built from | Runs |
|---|---|---|
| `index.html` → `src/main.tsx` | `src/ide/**` | The React IDE shell |
| `runtime.html` → `src/runtime-host/main.ts` | `src/runtime-host/**` + `src/runtime/**` | Phaser + user code, inside a sandboxed iframe |
| `server/index.ts` | `server/**` | Fastify + SQLite, also serves `dist/` — development |
| `worker/index.ts` | `worker/**` + `src/shared/**` | Cloudflare Worker + D1, also serves `dist/` — production |

```
┌─────────────────────────── React IDE shell ───────────────────────────┐
│ ┌──────── Stage panel ────────┐  ┌──────── Code panel ─────────────┐  │
│ │ ▶ Run (green flag) ■ Stop   │  │ tabs: [main] [Cat] [Bat] ...    │  │
│ │ ┌─────────────────────────┐ │  │ ┌─────────────────────────────┐ │  │
│ │ │  sandboxed <iframe>     │ │  │ │  Monaco editor              │ │  │
│ │ │  Phaser stage 480×360   │ │  │ │                             │ │  │
│ │ └─────────────────────────┘ │  │ └─────────────────────────────┘ │  │
│ │ sprites / backdrops / sounds│  │ API reference │ console pane    │  │
│ └─────────────────────────────┘  └─────────────────────────────────┘  │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ REST (create / load / update project)
                     ┌─────────┴─────────┐
                     │ Node + Fastify    │  serves the built client too
                     │ SQLite            │
                     └───────────────────┘
```

### Layers

- **`src/shared/`** — used by IDE, runtime, and server. `project.ts` (the save document and
  its pure edit functions), `projectSchema.ts` (validation + a 10 MB cap),
  `protocol.ts` (every message crossing the iframe boundary, with type guards),
  `apiDefs.ts`, `scratchCatalog.ts`.
- **`src/runtime/`** — the engine, framework-free and Phaser-free. `World` owns sprites,
  clock, event bus, sounds, and the pen op queue; `Executor` compiles user scripts;
  `spriteApi.ts` is the Scratch-shaped surface; `errors.ts` produces the kid-facing
  messages. Most of the unit tests live here, precisely because nothing here renders.
- **`src/runtime-host/`** — the Phaser adapter. `session.ts` builds a `World` from a
  payload and drives it, `scene.ts` renders snapshots, `spriteViews.ts` / `textureKeys.ts`
  reconcile.
- **`src/ide/`** — the React shell. `store.ts` is a reducer holding all IDE state,
  `bridge.ts` is the parent half of the iframe protocol, `library.ts` / `scratchAssets.ts`
  / `upload.ts` / `rehydrate.ts` handle assets, `api.ts` talks to the server.
- **`server/`** — the development server. `app.ts` (wiring, error handler, log redaction),
  `routes.ts` (a Fastify adapter over `src/shared/api.ts`), `db.ts` (SQLite via
  `node:sqlite`), `static.ts`, `ids.ts`.
- **`worker/`** — the production server. `index.ts` (a Cloudflare adapter over the same
  `src/shared/api.ts`), `d1Store.ts`. No `node:` builtins exist here; `worker/tsconfig.json`
  typechecks it against Cloudflare's types so one cannot sneak in.

### The iframe boundary is the central design fact

Run serializes the project into a `RunPayload` and posts it to a freshly mounted
`<iframe sandbox="allow-scripts" src="/runtime.html">`; Stop unmounts it. Consequences that
are easy to break without noticing:

- The iframe is keyed on `runId` — a new run **must** get a new document. `Executor.run()`
  has no teardown, so reusing a `World` double-registers every handler and watch.
- The sandbox has no `allow-same-origin`, so the iframe's origin is opaque. Module scripts
  are always fetched in CORS mode, so `runtime.html` and `assets/*` **must** be served with
  `Access-Control-Allow-Origin: *` or the stage silently stays blank. Handled in
  `vite.config.ts` (dev/preview) and `server/static.ts` (production). This one was caught
  by the e2e suite, not by unit tests or review.
- `runtime-host/main.ts` refuses to run unless its own origin is opaque, and `static.ts`
  sends `frame-ancestors 'self'` for `runtime.html` — any page can otherwise embed it
  unsandboxed and post a `run` message.
- Both `postMessage` directions use `targetOrigin: '*'`, because an opaque origin can't be
  named. Nothing secret crosses this boundary; keep it that way.

### The API surface has one source of truth

[`src/shared/apiDefs.ts`](src/shared/apiDefs.ts) defines all 60 user-facing functions
exactly once — signature, kid-friendly description, runnable example, category, and whether
it lives on a sprite or is global. The API reference drawer, Monaco autocomplete, and the
docs are all generated from it, so they cannot drift from behavior.

The categories mirror Scratch's block palette:

| Category | Count | Examples |
|---|---|---|
| Motion | 14 | `move`, `glide`, `pointTowards`, `ifOnEdgeBounce`, `x`/`y`/`direction` |
| Looks | 11 | `say`, `switchCostume`, `setSize`, `setEffect`, `goToFront` |
| Pen | 9 | `penDown`, `stamp`, `setPenColor`, `changePen`, `eraseAll` |
| Events | 7 | `onStart`, `onKeyPress`, `onClick`, `onMessage` / `broadcast`, `onUpdate` |
| Sensing | 6 | `touching`, `distanceTo`, `mouse`, `keyIsDown`, `timer`, `resetTimer` |
| Control | 5 | `wait`, `clone`, `onCloneStart`, `deleteClone`, `stopAll` |
| Sound | 3 | `playSound`, `playSoundUntilDone`, `setVolume` |
| Stage | 2 | `switchBackdrop`, `nextBackdrop` |
| Variables | 2 | `vars`, `watch` |

Adding an API means editing `apiDefs.ts` **and** implementing it in `src/runtime/` —
`apiDefs.test.ts` guards the pairing. Never document a capability only in prose.

### The project document

One JSON shape in transit, in SQLite, and in memory
([`src/shared/project.ts`](src/shared/project.ts)). Scripts are stored as plain source
strings and compiled fresh in the iframe on every Run — nothing executable is persisted.
`version: 1` is there for future migrations.

Assets are *referenced*, never described. An `AssetRef` is `{ name, source }`, where source
is one of:

- `library:<id>` — bundled in `public/library/`, works offline
- `scratch:<md5ext>` — fetched from Scratch's CDN on demand
- a `data:` URL — uploads, downscaled to ≤ 480×360 on import

Pixel dimensions live in the in-memory `AssetStore`, *not* on the ref: a ref that cached a
width could disagree with the bytes it points at. That split is why `rehydrate.ts` exists —
opening a saved project in a fresh browser starts with an empty store, so uploaded and
`scratch:` assets are re-measured or re-fetched before Run. One broken asset reports an
issue and is skipped; a kid's whole game must never fail to open over one costume.

`public/library/scratch-catalog.json` is **generated, not committed**. `make catalog` runs
`node scripts/build-scratch-catalog.ts`, which pins a `scratch-gui` commit SHA for
reproducibility and downloads **metadata only** — 339 sprites, 886 costumes, 85 backdrops,
and 353 sounds' worth of names, tags, and MD5 identifiers, no bytes. `make dev`,
`make build`, and the e2e targets depend on it, so you rarely invoke it directly.

It is generated rather than committed for licensing reasons, not technical ones — see
[Licensing](#licensing). Its absence is non-fatal by design: without it the library dialog
says the Scratch tab is unavailable and the built-in ten assets still work. See
[`docs/sprite_libraries.md`](docs/sprite_libraries.md).

### Persistence and the secret-link model

No accounts. A project id is a 16-byte base64url capability: whoever holds `/p/<id>` can
read and edit it.

| Route | Purpose |
|---|---|
| `POST /api/projects` | Create; returns `{ id }` |
| `GET /api/projects/:id` | Load |
| `PUT /api/projects/:id` | Update |

Because the id *is* the credential, it must never be logged. `app.ts` installs a pino
request serializer that rewrites both `/api/projects/<id>` and `/p/<id>` out of the log
line, and `server/app.test.ts` verifies it against real pino output. **Any new route
carrying an id needs the same treatment.**

Save concurrency is handled by a `saveToken` in `store.ts`: any edit or project-load bumps
it, and a `saved` / `save-failed` action carrying a stale token is discarded — so the UI
never claims work is safe when it isn't, never reattaches the wrong game's id, and never
strands the button on "Saving…".

## Before deploying this

`POST /api/projects` is unauthenticated and unmetered. A loop of maximum-size (10 MB)
creates fills the disk and takes everyone's saves down. Per-IP rate limiting and a
total-database-size circuit breaker are recorded as a **hard pre-deployment requirement**
in [`docs/TODO.md`](docs/TODO.md), alongside the rest of the deferred work and the
knowingly accepted trade-offs.

## Contributing

- Design specs go in `docs/superpowers/specs/`, implementation plans in
  `docs/superpowers/plans/`, both dated. Non-trivial features get a spec commit (`docs: …`)
  before the implementation commit.
- `docs/TODO.md` is the live register of deferred work and accepted trade-offs — check it
  before "fixing" something that looks wrong, and add to it when you knowingly defer.
- Comments explain *why*: a non-obvious constraint, or a bug that was actually hit. No
  comments restating the code.
- Commit subjects are lowercase, imperative, `type: summary` (`feat:`, `fix:`, `docs:`,
  `test:`).
- **Every message a user can see is written for a child** — validation errors, server
  errors, refusals. Copy the tone of the ones in `src/runtime/errors.ts` and
  `server/routes.ts`.
- `server/` and `scripts/` import with explicit `.ts` extensions and are typechecked under
  `tsconfig.server.json` with `erasableSyntaxOnly`: no enums, no parameter properties, no
  decorators in those directories, because Node strips types rather than compiling them.

## Deploying

Production runs on Cloudflare: the built client on Workers static assets, the three API
endpoints on a Worker, saved games in D1. The Fastify server in `server/` remains the
development server — `make server` and `make test-e2e-server` are unchanged.

One-time setup:

```bash
npx wrangler d1 create game-grand      # paste the printed id into wrangler.jsonc
npx wrangler d1 migrations apply game-grand --remote
cp .env.example .env                   # add a token scoped to Workers Scripts + D1 only
```

Then, from `main` with a clean tree:

```bash
make deploy
```

Deploys run from your machine, not CI, so the script is the gate CI would otherwise be: it
refuses to run off `main`, refuses a dirty tree, and runs the typechecks, unit suite, and
build before shipping. `.env` is gitignored and must stay that way — this repository is
public, and a committed token stays leaked whatever the history says afterwards.

To run the real Worker locally against a local D1, with **no Cloudflare account needed**:

```bash
make worker-dev        # http://localhost:5177
make test-e2e-worker   # the full e2e suite against it
```

That mode is the only one covering the `_headers` rules, the `/p/<id>` fallback, and D1.
It has already earned its keep: Cloudflare's default `html_handling` redirects
`/runtime.html` to `/runtime`, where the header rules no longer match — dropping the
`Access-Control-Allow-Origin` the sandboxed stage needs and the `frame-ancestors` that
protects it. `wrangler.jsonc` sets `html_handling: "none"` for exactly that reason.

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

## Licensing

**This repository redistributes nothing from Scratch.** That is a deliberate boundary, and
it is why the catalog is generated rather than committed.

| Thing | Where it comes from | License |
|---|---|---|
| Everything in `src/`, `server/`, `scripts/`, `e2e/` | Written for this project | **[MIT](LICENSE)** |
| The ten starter assets in `public/library/` | Drawn for this project — a few hundred bytes of SVG primitives each | **[MIT](LICENSE)** |
| `scratch-catalog.json` | Generated on your machine from [scratch-gui](https://github.com/scratchfoundation/scratch-gui) | **AGPL-3.0**, from the Scratch Foundation |
| Sprite/backdrop/sound media | Fetched by the browser from `assets.scratch.mit.edu` as a project uses it | **[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)** |

The bottom two rows never enter this repository or its build output. The catalog's data is
AGPL-licensed, so committing it would entangle this project's own license; `make catalog`
fetches it from the Scratch Foundation directly instead. The media is CC BY-SA, which
requires attribution — the library dialog credits Scratch, as the license requires — but it
does not reach this project's code: a JavaScript runtime is not an adaptation of a cat
drawing.

"Scratch" is a trademark of the Scratch Foundation. This project is Scratch-*inspired* and
is not affiliated with or endorsed by them.

Details in [`public/library/LICENSE.md`](public/library/LICENSE.md) and
[`docs/sprite_libraries.md`](docs/sprite_libraries.md).
