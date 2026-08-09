# TODO — deferred features

Items intentionally left out of v1, to follow up later.

## Plan 3 (server) hard requirement

- [x] **The server must send `Access-Control-Allow-Origin: *` for `runtime.html` and its bundle.** The stage runs in `<iframe sandbox="allow-scripts">`, which gives it an opaque (`null`) origin, and module scripts are always fetched in CORS mode. Without the header the iframe cannot load its own JavaScript and the stage stays blank — this was caught by the e2e suite, not by unit tests or review. Vite's dev and preview servers are configured for it in `vite.config.ts`; a production server must do the same. Implemented in `server/static.ts`, verified by `server/app.test.ts` and by the full e2e suite passing against the real server (`E2E_SERVER=1`).
- [x] **The server must also send `Content-Security-Policy: frame-ancestors 'self'` for `runtime.html`.** `main.ts` already refuses to start a run unless `self.origin === 'null'` (proof it's inside the app's own sandboxed iframe), but that's a client-side check; `frame-ancestors` stops another origin from framing `runtime.html` at all, which matters once Plan 3 adds saved projects and secret links. Implemented in `server/static.ts`, verified by `server/app.test.ts`.
- [ ] **The server must rate-limit and cap anonymous project creation before it is ever deployed.** `POST /api/projects` is unauthenticated and unmetered — a loop of maximum-size (10 MB) creates fills the disk and takes everyone's saves down, and nothing today makes that expensive or rare. Not built now (deploying is out of scope for this plan); before deployment this needs per-IP rate limiting on `POST`/`PUT /api/projects*` (`@fastify/rate-limit`) and a total-database-size circuit breaker that refuses new creates once storage crosses a threshold.

## Plan 2 contract notes (from Plan 1 final review)

- **One run = one fresh `World` + `Executor`.** `Executor.run()` has no teardown; calling it twice on the same World double-registers every handler and watch. The iframe-restart-per-Run design guarantees this naturally — do not reuse a World across runs.
- `world.sprites` is reassigned (not mutated) by clone/layer operations — always re-read the field, never cache the array.
- Renderers reconcile snapshot sprites by the stable `id` field (clones share `name`; array order mutates).

## Engine follow-ups (parked with rulings at Plan 1 final review)

- [ ] Sandbox `has`-trap makes `typeof undeclaredVar` throw ReferenceError instead of returning "undefined" (src/runtime/executor.ts makeSandbox). Ruled acceptable for the audience; revisit if pasted library code breaks.
- [ ] Bare assignment to the getter-only `timer` global throws a raw TypeError instead of a friendly error (executor.ts sandbox set trap in strict module context).
- [ ] `display()` routes Error instances through JSON.stringify, losing `message` (src/runtime/display.ts) — special-case `Error`.
- [ ] Orphaned sprite scripts (no matching sprite) are silently skipped by `Executor.run()` — consider emitting a ScriptIssue.
- [ ] `npm audit`: 5 vulns in transitive dev deps (1 critical) at scaffold time — maintenance pass.
- [ ] Uploaded images are recorded at their downscaled dimensions but the original full-resolution bytes are still sent into the iframe; re-encode on upload to shrink payloads.
- [x] Backdrops and sounds are still keyed by name in the Phaser scene (`scene.ts` preload/playSound), the same collision class fixed for costumes: an uploaded backdrop or sound sharing a library asset's name silently wins/loses. Key them by asset identity too. Fixed by extending `buildTextureIndex` (`src/runtime-host/textureKeys.ts`) to cover backdrops and sounds and routing all three `scene.ts` sites through it — including `render()`, which fed a snapshot backdrop *name* straight into `setTexture` — alongside unique-naming in `src/shared/project.ts`.
- [ ] `searchApi` does not search example text (e.g. searching "beep" won't surface `playSound`).
- [ ] Some API examples reference sprites a fresh project lacks (`sprite.touching("Bat")`), so Insert-example can throw when run before that sprite exists.
- [ ] The Scratch library depends on `assets.scratch.mit.edu` at runtime: a saved game using Scratch assets won't open if MIT blocks or changes that endpoint, and every player's IP is exposed to it. Mirroring the ~1,331 referenced assets onto our own origin would remove both, at the cost of hosting them.
- [ ] If a `connect-src` CSP is ever added to the app, it must include `https://assets.scratch.mit.edu` or the whole Scratch library goes dark.
- [ ] Scratch's `rotationCenterX/Y` is ignored — our engine is centre-anchored, so off-centre Scratch costumes sit slightly differently than they do in Scratch.
- [ ] `rehydrateAssetStore` passes `res: 1` for every `scratch:` ref on load, because the ref carries identity only. Harmless today (the only `res: 2` assets are 960×720 backdrops that `downscale` caps to 480×360 either way), but a future retina costume smaller than the stage would load at double size. Storing `res` alongside the ref, or looking it up in the catalog at load time, would close it.
- [ ] `make dev` and `make server-dev` are two separate commands a kid/dev must remember to run together for Save/Load to work locally (`vite.config.ts` proxies `/api` to `:8080`, but nothing starts that second process). A combined target (e.g. `make dev-all` running both, or a single dev server that also mounts the API) would remove the foot-gun — not built now since it needs a decision on process supervision (concurrently? two terminals documented? a wrapper script?).

## Asset panel follow-ups (deferred from the Sprites/Backdrops/Sounds tabs)

- [ ] **Sprite costumes need the same list treatment.** A Scratch sprite arrives with several costumes (`cat-a`, `cat-b`) and `sprite.switchCostume("cat-b")` is in the API reference, but nothing shows those names — exactly the gap the tabs closed for backdrops and sounds. Needs a new "add a costume to an existing sprite" action (`setPicking('costume')` currently creates a whole new sprite, `App.tsx`), a nested list under the selected sprite, and a "a sprite must keep at least one costume" rule mirroring the stage's.
- [ ] **Renaming or deleting a *sprite* gives no reference warning**, though `sprite.touching("Bat")` breaks exactly the way `playSound("meow")` does. `scriptsReferencing` (`src/ide/references.ts`) is already built and used for backdrops and sounds; wiring it into the sprite row's Rename and Delete would close the gap.
- [ ] **Backdrops can't be reordered**, and `stage.nextBackdrop()` walks the list in order — so the order is meaningful but fixed at the order they were added. Drag-to-reorder, or plain up/down buttons, would make `nextBackdrop` sequences designable.

- [ ] **Export project to file / Import from file** — download and restore a project as a `.json` file (deferred from v1 top bar; v1 is server save/load-by-link only).
- [ ] **Costume editor (Phase 2)** — in-app paint/pixel editor for drawing sprite costumes and backdrops.
- [ ] **Accounts (Phase 3)** — sign-in and ownership. Plan 3 shipped server-side project storage and share-by-link (capability-id URLs, no listing/enumeration); the save format is unchanged, so accounts can layer on later by adding an owner column rather than migrating documents.
