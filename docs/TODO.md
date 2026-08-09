# TODO — deferred features

Items intentionally left out of v1, to follow up later.

## Plan 3 (server) hard requirement

- [ ] **The server must send `Access-Control-Allow-Origin: *` for `runtime.html` and its bundle.** The stage runs in `<iframe sandbox="allow-scripts">`, which gives it an opaque (`null`) origin, and module scripts are always fetched in CORS mode. Without the header the iframe cannot load its own JavaScript and the stage stays blank — this was caught by the e2e suite, not by unit tests or review. Vite's dev and preview servers are configured for it in `vite.config.ts`; a production server must do the same.
- [ ] **The server must also send `Content-Security-Policy: frame-ancestors 'self'` for `runtime.html`.** `main.ts` already refuses to start a run unless `self.origin === 'null'` (proof it's inside the app's own sandboxed iframe), but that's a client-side check; `frame-ancestors` stops another origin from framing `runtime.html` at all, which matters once Plan 3 adds saved projects and secret links.

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
- [ ] Backdrops and sounds are still keyed by name in the Phaser scene (`scene.ts` preload/playSound), the same collision class fixed for costumes: an uploaded backdrop or sound sharing a library asset's name silently wins/loses. Key them by asset identity too.
- [ ] `searchApi` does not search example text (e.g. searching "beep" won't surface `playSound`).
- [ ] Some API examples reference sprites a fresh project lacks (`sprite.touching("Bat")`), so Insert-example can throw when run before that sprite exists.

- [ ] **Export project to file / Import from file** — download and restore a project as a `.json` file (deferred from v1 top bar; v1 is localStorage save/load only).
- [ ] **Costume editor (Phase 2)** — in-app paint/pixel editor for drawing sprite costumes and backdrops.
- [ ] **Backend with accounts (Phase 3)** — server-side project storage, sign-in, share-by-URL. Save format is designed to be server-ready from v1.
