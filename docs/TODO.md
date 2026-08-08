# TODO — deferred features

Items intentionally left out of v1, to follow up later.

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

- [ ] **Export project to file / Import from file** — download and restore a project as a `.json` file (deferred from v1 top bar; v1 is localStorage save/load only).
- [ ] **Costume editor (Phase 2)** — in-app paint/pixel editor for drawing sprite costumes and backdrops.
- [ ] **Backend with accounts (Phase 3)** — server-side project storage, sign-in, share-by-URL. Save format is designed to be server-ready from v1.
