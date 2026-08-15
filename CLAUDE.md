# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web playground where kids write JavaScript instead of dragging Scratch blocks: stage on the left, Monaco editor on the right, games saved server-side and reopened via a secret link. The audience is beginners — every design choice favors forgiveness and clarity, and every user-facing error message is written for a kid. The full rationale lives in `docs/superpowers/specs/2026-08-08-game-playground-design.md`; read it before changing anything architectural.

## Commands

`make help` lists everything. The common ones:

```bash
make dev              # Vite dev server on :5173
make server-dev       # Fastify API on :8080 — needed for Save/Load; run in a second shell
make build            # tsc --noEmit + tsc -p tsconfig.server.json + vite build
make test-unit        # vitest run (~320 tests, sub-second)
make test-e2e         # Playwright against the dev server
make test-e2e-prod    # E2E_PREVIEW=1 — the production bundle is a different code path
make test-e2e-server  # E2E_SERVER=1 — real Fastify + disposable SQLite; only mode that runs save/load specs
make test-all         # all four
```

Single tests:

```bash
npx vitest run src/runtime/world.test.ts
npx vitest run -t 'glide resolves'
npx playwright test e2e/ide.spec.ts -g 'clone'
E2E_SERVER=1 npx playwright test e2e/save-load.spec.ts
```

`make dev` alone gives a working IDE but broken Save/Load — `vite.config.ts` proxies `/api` to `:8080` and nothing starts that process for you. This foot-gun is a known open item in `docs/TODO.md`.

Node ≥ 24 is required: the server runs TypeScript directly via Node's type stripping. That is why `server/` and `scripts/` import with explicit `.ts` extensions and are typechecked under `tsconfig.server.json` with `erasableSyntaxOnly` — no enums, no parameter properties, no decorators in those directories.

## Architecture

Three entry points, one shared vocabulary:

| Entry | Built from | Runs |
|---|---|---|
| `index.html` → `src/main.tsx` | `src/ide/**` | The React IDE shell |
| `runtime.html` → `src/runtime-host/main.ts` | `src/runtime-host/**` + `src/runtime/**` | Phaser + user code, inside a sandboxed iframe |
| `server/index.ts` | `server/**` | Fastify + SQLite, also serves `dist/` |

**The iframe boundary is the central design fact.** User code never runs in the IDE's realm. Run serializes the project into a `RunPayload` and posts it to a freshly-mounted `<iframe sandbox="allow-scripts" src="/runtime.html">`; Stop unmounts the iframe. That gives beginners a `while (true)` they can always escape from, and makes every Run a clean-slate restart like Scratch's green flag. Consequences that are easy to break:

- `StagePanel` keys the iframe on `runId` — a new run **must** get a new document. Reusing it would violate the one-`World`-per-run rule (`Executor.run()` has no teardown; a second call double-registers every handler and watch).
- `SpriteModel.x`/`.y` are getters; `place(x, y)` is the only writer. That is what lets the pen draw a segment for every movement — a motion method that assigned the fields directly would silently stop drawing.
- The sandbox has no `allow-same-origin`, so the iframe's origin is `null`. Module scripts are always fetched in CORS mode, so `runtime.html` and `assets/*` **must** be served with `Access-Control-Allow-Origin: *` or the stage silently stays blank. Handled in `vite.config.ts` (dev/preview) and `server/static.ts` (production); covered by `server/app.test.ts` and the e2e suite.
- `runtime-host/main.ts` refuses to run unless `self.origin` is opaque (`sandboxGuard.ts`), and `server/static.ts` sends `frame-ancestors 'self'` for `runtime.html`. Both exist because any page can embed `/runtime.html` unsandboxed and post a `run` message.
- Both `postMessage` directions use `targetOrigin: '*'` — an opaque origin can't be named. Nothing secret crosses this boundary; keep it that way.
- Message shapes and their type guards live in `src/shared/protocol.ts`. Everything crossing the boundary is validated there.

**Layer map:**

- `src/shared/` — used by IDE, runtime, and server. `project.ts` (the save document and its pure edit functions), `projectSchema.ts` (validation + `MAX_PROJECT_BYTES`), `protocol.ts`, `apiDefs.ts`, `scratchCatalog.ts`.
- `src/runtime/` — the engine, framework-free and Phaser-free. `World` owns sprites/clock/event bus/sounds and the pen op queue; `Executor` compiles user scripts; `spriteApi.ts` is the Scratch-shaped surface; `errors.ts` produces the kid-facing validation messages; `pen.ts`/`colors.ts` hold pen state and CSS-color parsing. This is where the bulk of the unit tests are, precisely because it has no rendering dependency.
- `src/runtime-host/` — the Phaser adapter. `session.ts` builds a `World` from a payload and drives it; `scene.ts` renders snapshots; `spriteViews.ts`/`textureKeys.ts` reconcile. Sprites reconcile by the stable `id` field, never by name (clones share names) and never by array position (`world.sprites` is *reassigned* by layer/clone ops — always re-read it, never cache).
- `src/ide/` — React shell. `store.ts` is a reducer holding all IDE state; `bridge.ts` is the parent half of the iframe protocol; `library.ts`/`scratchAssets.ts`/`upload.ts`/`rehydrate.ts` handle assets; `api.ts` talks to the server.
- `server/` — `app.ts` (wiring, error handler, log redaction), `routes.ts` (3 endpoints), `db.ts` (SQLite via `node:sqlite`, documents stored as opaque JSON strings), `static.ts`, `ids.ts`.

### The API surface has one source of truth

`src/shared/apiDefs.ts` defines every user-facing function once — signature, kid-friendly description, runnable example, category, sprite-vs-global scope. The API reference drawer (`ide/reference.ts`), Monaco autocomplete (`ide/completions.ts`), and the docs are all generated from it. Adding an API means editing `apiDefs.ts` **and** implementing it in `runtime/` — `src/shared/apiDefs.test.ts` guards the pairing. Never document a capability only in prose.

### The project document

One JSON shape in transit, in SQLite, and in memory (`src/shared/project.ts`). `version: 1` is there for future migrations. Scripts are stored as plain source strings and compiled fresh in the iframe on every Run — nothing executable is persisted.

Assets are referenced, never described: an `AssetRef` is `{ name, source }` where source is `library:<id>` (bundled, in `public/library/`), `scratch:<md5ext>` (fetched from Scratch's CDN on demand), or a `data:` URL (uploads). Pixel dimensions live in the in-memory `AssetStore`, *not* on the ref — a ref that caches a width can disagree with the bytes it points at. `docs/sprite_libraries.md` explains why this mirrors Scratch's own catalogs.

That split is why `rehydrate.ts` exists: opening a saved project in a fresh browser has an empty `AssetStore`, so uploaded and `scratch:` assets must be re-measured/re-fetched before Run or the resolver throws. One broken asset reports an issue and is skipped — a kid's whole game must not fail to open over one costume.

User code addresses assets by name (`playSound("meow")`), so names are made unique on add (`uniqueAssetName`) and textures are keyed by asset *identity* rather than name (`runtime-host/textureKeys.ts`) — the schema only enforces unique sprite names.

`public/library/scratch-catalog.json` is **generated, not checked in** — `make catalog` (a prerequisite of `make dev`, `make build`, and the e2e targets) runs `node scripts/build-scratch-catalog.ts`, which pins a `scratch-gui` commit SHA for reproducibility and downloads metadata only. It stays out of the repo because scratch-gui is AGPL-3.0 and this project is not; do not commit it. Its absence is non-fatal by design: the library dialog falls back to the built-in ten. `make test-unit` deliberately does not depend on it, so the fast suite still runs with no network. Scratch media is CC BY-SA 4.0 — see `public/library/LICENSE.md`.

### Persistence and the secret-link model

No accounts. A project id is a 16-byte base64url capability: whoever holds `/p/<id>` can read and edit. Therefore ids must never be logged — `app.ts` installs a pino request serializer that rewrites both `/api/projects/<id>` and `/p/<id>` out of the log line, and `server/app.test.ts` verifies it against real pino output. Any new route carrying an id needs the same treatment.

`POST /api/projects` is unauthenticated and unmetered; rate limiting plus a storage circuit breaker are a hard pre-deployment requirement recorded in `docs/TODO.md`.

Save concurrency is handled by `saveToken` in `store.ts`: any edit or project-load bumps it, and a `saved`/`save-failed` action carrying a stale token is discarded so the UI never claims work is safe when it isn't, never reattaches the wrong game's id, and never strands the button on "Saving…".

## Testing

`vitest` runs in the **node** environment (`vite.config.ts`) — there is no jsdom and there are no React component tests. Logic that needs testing is deliberately pulled out of components into plain modules (`store.ts`, `references.ts`, `catalogSearch.ts`, `completions.ts`). Put new logic there rather than reaching for a DOM test runner.

Playwright owns anything involving the real iframe, Monaco, or the browser. `vite.config.ts` excludes `e2e/**` from vitest. The e2e suite runs in three modes against the same specs; `save-load.spec.ts` and part of `scratch-library.spec.ts` `test.skip` unless `E2E_SERVER=1`. This layer has caught bugs the unit tests structurally cannot (the CORS failure above, unrunnable `await` examples) — when a change touches the boundary, run at least `make test-e2e-server`.

Playwright helpers in `e2e/helpers.ts` are carefully scoped (`.library-builtin`, `.asset-tabs`) because the Scratch catalog and the built-in library share labels like "Cat". Reuse them instead of writing fresh locators.

## Conventions

- Design specs go in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`, both dated. Non-trivial features get a spec commit (`docs: …`) before the implementation commit.
- `docs/TODO.md` is the live register of deferred work, accepted trade-offs, and pre-deployment blockers — check it before "fixing" something that looks wrong, and add to it when you knowingly defer.
- Comments in this codebase explain *why*, usually a non-obvious constraint or a bug that was actually hit. Match that: no comments restating the code.
- Commit subjects are lowercase, imperative, `type: summary` (`feat:`, `fix:`, `docs:`, `test:`).
- Every message a user can see — validation errors, server errors, refusals — is written for a child. Copy the tone of the existing ones in `src/runtime/errors.ts` and `server/routes.ts`.
