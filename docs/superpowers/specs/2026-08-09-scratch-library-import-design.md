# Scratch Library Import — Design

**Date:** 2026-08-09
**Status:** Approved by user (brainstorming session)
**Builds on:** `docs/superpowers/specs/2026-08-08-game-playground-design.md`, `docs/sprite_libraries.md`

## What we're building

Give the playground access to the **entire Scratch media library** — 339
sprites, 886 costumes, 85 backdrops, and 353 sounds — fetched from Scratch's
CDN on demand and picked through a searchable dialog. The ten hand-authored
assets stay put as the offline core; this adds to them rather than replacing
them.

Today `public/library/` holds 5 costumes, 2 backdrops, and 3 sounds;
`scripts/fetch-scratch-library.mjs` adds one asset per invocation from a
hand-typed `md5ext`. That script is superseded by this design.

## Decisions made

| Decision | Choice |
|---|---|
| Scope | Everything Scratch has (1,331 distinct assets) |
| Where the bytes live | Fetched from `assets.scratch.mit.edu` at runtime; nothing bundled, nothing downloaded at build time |
| Granularity | Sprites (with their full costume set) **plus** flat costumes / backdrops / sounds |
| Dimensions | Measured in the browser at fetch time, not stored in the catalog |
| Asset ref scheme | `scratch:<md5ext>` — content-addressed |
| Local assets | The existing ten stay, as the always-works offline core |

## Facts established during design

These were measured against the live catalogs and CDN, not assumed.

| | |
|---|---|
| Catalog counts | 339 sprites (avg 2.6 costumes, max 13), 886 costumes, 85 backdrops, 353 sounds |
| Distinct assets | **1,331** — sprite costumes overlap `costumes.json`, and MD5 identity dedupes them for free |
| Stripped catalog size | **278 KB raw, 73 KB gzipped** — small enough to check in |
| CDN CORS | `access-control-allow-origin: *` on `https://assets.scratch.mit.edu/internalapi/asset/<md5ext>/get/` |
| CDN caching | `cache-control: max-age=31536000, must-revalidate`; ETag *is* the MD5 |
| Formats | Costumes/backdrops `svg` or `png`; sounds `wav` |
| Free metadata | `tags` on every entry (379 distinct); `sampleCount`/`rate` on sounds → duration without decoding |
| Our own CSP | Only `frame-ancestors 'self'` on `runtime.html`; no `connect-src`, so nothing blocks the CDN |

**Gotchas found in the data:**

- `bitmapResolution: 2` PNGs are retina art — the `Arctic` backdrop is 960×720
  pixels and must render at 480×360. Divide measured pixels by
  `bitmapResolution`.
- `dataFormat` is sometimes the empty string (e.g. the sound `A Bass`). Trust
  the extension on `md5ext`, never `dataFormat`.
- `sprites.json` carries `blocks` and `variables` — Scratch block definitions,
  meaningless to our JavaScript engine. Stripping them is most of why the
  catalog shrinks from 540 KB to 278 KB.

## Architecture

```
build time (rare, manual)          runtime (per pick / per open)
─────────────────────────          ─────────────────────────────
scratch-gui @ pinned SHA           LibraryDialog
  sprites/costumes/                  │ search + tags, lazy thumbs
  backdrops/sounds.json              ▼
        │                          scratchAssets.ts
        │ strip blocks,              │ fetch md5ext → data URL
        │ keep identity+tags         │ measure → ÷ bitmapResolution
        ▼                            ▼
public/library/                    AssetStore  (source → {dataUrl, w, h})
  scratch-catalog.json               │
  (278 KB, checked in)               ▼
                                   toRunPayload → sandboxed iframe
```

The catalog is checked in and describes *what exists*. The CDN provides *the
bytes*, only for assets a project actually uses. The `AssetStore` — which
already keys on `AssetRef.source` — is the join point, and needs no change to
its shape.

### 1. Catalog generator

`scripts/build-scratch-catalog.mjs` reads the four catalogs from
`scratchfoundation/scratch-gui` **pinned to a commit SHA** (not `develop`, so
regeneration is reproducible), strips `blocks`/`variables`, and writes
`public/library/scratch-catalog.json`. It downloads **no asset bytes**.
Re-running it is how we pick up newly added Scratch assets.

```json
{
  "source": "scratch-gui@dae2a97a5bb0cd8a7513fafd60f9e7488f2a89a4",
  "license": "CC-BY-SA-4.0",
  "sprites":   [{ "name", "tags": [], "costumes": [{ "name", "md5ext", "res" }], "sounds": [{ "name", "md5ext" }] }],
  "costumes":  [{ "name", "tags": [], "md5ext", "res" }],
  "backdrops": [{ "name", "tags": [], "md5ext", "res" }],
  "sounds":    [{ "name", "tags": [], "md5ext", "seconds" }]
}
```

There is deliberately **no `id` field**: an asset's identity is its `md5ext`,
and a sprite's is its `name` — verified unique across all four catalogs, with
zero duplicates. Inventing a third identifier would only create something that
can disagree with those two.

`seconds` is `sampleCount / rate`, precomputed because it is free and lets the
dialog show durations without fetching a single byte.

### 2. Ref scheme: `scratch:<md5ext>`

A saved project stores `{ name: "Abby", source: "scratch:809d9b47….svg" }`.
Because the ref names the *bytes* rather than a catalog slot, regenerating or
re-curating the catalog can never break an existing saved game. This mirrors
the principle already stated in `docs/sprite_libraries.md`: a reference
identifies an asset, it does not describe it.

`projectSchema.ts` validates `source` as an unconstrained string, so **the save
format does not change and no migration is needed.** The existing ten assets
keep their `library:<id>` refs, including the `DEFAULT_BACKDROP`.

### 3. Fetch and measure on demand

New module `src/ide/scratchAssets.ts`:

- `fetchScratchAsset(md5ext, res)` → CDN fetch → blob → data URL → decode
  through `measureImage` (already in `upload.ts`, already injectable) →
  divide by `res` → apply the existing `downscale` cap → `LoadedAsset`.
- Sounds skip measurement entirely; they carry duration, not dimensions.
- Concurrent requests for the same `md5ext` share one in-flight promise. The
  `AssetStore` is the memo; the browser's HTTP cache does the real caching,
  which is why the year-long `max-age` on content-addressed URLs matters.

`makeResolver` is untouched. `preloadLibrary` shrinks to just the ten local
assets, so startup stays instant instead of pulling 1,331 files.

### 4. The two load moments

This is the correctness core of the design. The invariant is: **a project must
never reference an asset the store lacks**, because `makeResolver` throws
`Asset "…" has not been loaded.` at Run time if it does.

- **On pick** — fetch the asset's bytes *before* dispatching
  `add-sprite` / `add-backdrop` / `add-sound`. The dialog shows progress and
  leaves the project untouched if the fetch fails.
- **A sprite pick adds its costumes *and* its sounds.** All 339 sprites carry
  at least one sound, and picking `Cat` without `meow` would be a strange
  result. Every costume in the set is fetched (so `nextCostume()` animates
  immediately); the sounds are added as refs and fetched with them.
- **On open** — `rehydrate.ts` today resolves `data:` uploads and deliberately
  skips `library:` refs because `preloadLibrary` covered them. It must now also
  resolve every `scratch:` ref in the project, in parallel, reporting a
  per-asset issue on failure instead of aborting the load. Its existing
  one-bad-asset-doesn't-sink-the-game behavior extends to the new scheme
  unchanged.

### 5. Dialog rebuild

`LibraryDialog.tsx` becomes a real browser rather than a flat list:

- Kind tabs: Sprites / Costumes / Backdrops / Sounds.
- Search across name **and** tags.
- Curated tag chips from the most common tags in the data — people, animals,
  fantasy, sports, food, space, music, effects.
- Thumbnails lazy-loaded via `IntersectionObserver`. Rendering 886 `<img>`
  tags with eager data URLs is exactly the failure this design exists to
  avoid.
- Sounds list their duration from the catalog and fetch only when Played.
- **Attribution footer** naming the Scratch project and linking CC BY-SA 4.0 —
  a license obligation, not a nicety. `public/library/LICENSE.md` is updated to
  match, since it currently describes assets added by the superseded script.

### 6. Name collisions — a correctness fix, not a cleanup

Sprite costumes, backdrops, and sounds are addressed **by name in user code**:
`playSound("meow")`, `stage.switchBackdrop("night")`. A duplicate name makes a
kid's program ambiguous, so this is a correctness problem rather than a
rendering one.

Names are unique *within* each Scratch catalog (verified: zero duplicates in
all four). The collisions come from elsewhere, and they are real:

- `pop` is attached to **197 different sprites**, `meow` to 28.
- `Goal Cheer`, `Referee Whistle`, and `Water drop` each name **two different
  assets**.
- The sprite `Shark 2` carries two distinct sounds **both named `Water drop`**
  — adding that one sprite alone produces an ambiguous `playSound`.
- Our own local `pop` sits alongside Scratch's separate `Pop`.

Two changes, at the two layers where it matters:

1. **Unique names at add time** (`src/shared/project.ts`). `addSound` and
   `addBackdrop` gain the de-duplicating suffix behavior `uniqueSpriteName`
   already provides for sprites, and a sprite's costume set is de-duplicated
   within the sprite. Identical `source` values continue to dedupe to a single
   entry, as `addSound` already does — so 197 sprites carrying the same `pop`
   asset still yield one `pop`.
2. **Identity keying in the scene** (`src/runtime-host/`). `buildTextureIndex`
   currently keys sprite costumes by `dataUrl` but backdrops still load under
   `b.name` (`scene.ts:48`) and sounds under `s.name` (`scene.ts:50`). Both get
   the same identity treatment, closing the item already parked at
   `docs/TODO.md:25`.

### 7. Type cleanup

The new catalog types carry no dimensions at all: images carry `res`, sounds
carry `seconds`. This is why the `width: 0, height: 0` placeholder that every
sound in `library.json` needs has no equivalent in the Scratch catalog — the
question it answers is never asked.

`LibraryEntry` and `library.json` are **unchanged**. The ten local assets are
bundled, so precomputing their dimensions is the right call for them, and
rewriting that file would churn the manifest, its tests, and the e2e suite for
no gain. `LoadedAsset` also keeps `width`/`height` — it describes a *decoded*
asset, and the engine genuinely needs those for collision boxes.

### 8. Failure behavior

The runtime-CDN choice makes availability a design concern, so it is handled
explicitly rather than left to chance:

- **CDN unreachable while browsing** — inline error plus Retry in the dialog.
  The ten local assets, the default backdrop, and any game built only from them
  keep working.
- **A `scratch:` ref fails on open** — a console issue naming the affected
  sprite; the game still opens and everything else still runs.
- **Accepted risks, stated plainly:** a saved game depends on MIT continuing to
  serve that endpoint, and every player's IP is exposed to `scratch.mit.edu`.
  Both follow directly from the hosting decision.

## Testing

- **Unit** — the generator against a checked-in fixture slice of the four
  catalogs (never the network); `scratchAssets` fetch / measure /
  `bitmapResolution` division / in-flight dedupe / error paths; `rehydrate`
  with `scratch:` refs; unique-naming in `project.ts`; `buildTextureIndex`
  covering backdrops and sounds; dialog search and tag filtering as pure
  functions.
- **E2E** — pick a Scratch sprite → Run → it renders; save → reload → the
  costume survives; Playwright `route`-abort the CDN → friendly error, no
  crash. Following the existing convention, logic lives in pure modules with
  unit tests and no jsdom is introduced.
- The existing suites must stay green; they rely on the ten local assets, which
  is precisely why those stay.

## Out of scope

- Mirroring or caching Scratch assets on our own server.
- `rotationCenterX/Y` anchoring. Our engine is centre-anchored, so off-centre
  Scratch costumes sit slightly differently than in Scratch. Already documented
  in `docs/sprite_libraries.md`; unchanged here.
- A per-asset credits page beyond the dialog footer.
- Scratch's `blocks`/`variables` — stripped, never interpreted.

**One note for later:** if a `connect-src` CSP is ever added to the app, it must
include `https://assets.scratch.mit.edu` or the entire library goes dark.
