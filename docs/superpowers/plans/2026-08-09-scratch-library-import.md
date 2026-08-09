# Scratch Library Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the playground the entire Scratch media library — 339 sprites, 886 costumes, 85 backdrops, 353 sounds — through a checked-in catalog and on-demand CDN fetches, picked from a searchable dialog.

**Architecture:** A build-time script turns Scratch's four catalog JSONs into one 278 KB `scratch-catalog.json` that is checked in and describes *what exists* — identity and tags only, no bytes and no dimensions. At runtime the IDE fetches an asset from `assets.scratch.mit.edu` only when a project actually uses it, measures it in the browser, and puts it in the existing `AssetStore` under the ref `scratch:<md5ext>`. The ten hand-authored local assets stay exactly as they are, as the offline core.

**Tech Stack:** TypeScript run directly by Node 25 (type stripping, as `server/index.ts` already does), React 18, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-09-scratch-library-import-design.md`

## Global Constraints

- **`scratch:<md5ext>` is the only new ref scheme.** `library:<id>` refs and the ten local assets keep working unchanged, including `DEFAULT_BACKDROP` (`library:blue-sky`).
- **The save format does not change.** `projectSchema.ts` validates `source` as an unconstrained string. Do not add scheme validation there — a stricter schema would reject projects saved by a newer catalog.
- **Never download asset bytes at build time.** The generator reads JSON catalogs only.
- **Pinned upstream SHA:** `dae2a97a5bb0cd8a7513fafd60f9e7488f2a89a4`. Catalog URLs are `https://raw.githubusercontent.com/scratchfoundation/scratch-gui/<SHA>/src/lib/libraries/<name>.json`. Never fetch from `develop`.
- **CDN URL:** `https://assets.scratch.mit.edu/internalapi/asset/<md5ext>/get/` — note the trailing slash.
- **Trust `md5ext`'s extension, never `dataFormat`** (`dataFormat` is `""` for some sounds, e.g. `A Bass`).
- **Divide measured pixels by `bitmapResolution`.** A `res: 2` PNG is retina art; `Arctic` is 960×720 pixels and must render at 480×360.
- **No network in unit tests.** Every fetch is injected, exactly as `loadManifest`/`preloadLibrary` already do it in `src/ide/library.ts`.
- **No jsdom, no @testing-library.** Logic lives in pure modules with unit tests; React components stay thin. Component behavior is covered by Playwright.
- **All assets cross the iframe boundary as `data:` URLs.** The iframe is an opaque origin; never hand it an http URL.
- TDD every task: failing test → implement → pass → commit. One commit per task minimum.
- `src/runtime/**` (the engine) stays untouched. Only `src/runtime-host/**` changes.

## File Structure

```
scripts/build-scratch-catalog.ts       # pure transform + CLI; writes the catalog     (Task 1)
scripts/build-scratch-catalog.test.ts  # transform tested against inline fixtures     (Task 1)
src/shared/scratchCatalog.ts           # catalog types, imported by script and IDE    (Task 1)
public/library/scratch-catalog.json    # generated, checked in (~278 KB)              (Task 1)
tsconfig.server.json                   # + "scripts" in include                       (Task 1)

src/ide/scratchAssets.ts               # ref helpers, CDN fetch, measure, dedupe      (Task 2)
src/shared/project.ts                  # unique naming for sounds/backdrops/costumes  (Task 3)
src/runtime-host/textureKeys.ts        # identity keys for backdrops and sounds too   (Task 4)
src/runtime-host/scene.ts              # consume those keys                           (Task 4)
src/ide/catalogSearch.ts               # load catalog + search/filter/tag chips       (Task 5)
src/ide/rehydrate.ts                   # resolve scratch: refs when opening a game    (Task 6)
src/ide/components/LibraryDialog.tsx   # tabs, search, tag chips, lazy thumbnails     (Task 7)
src/ide/components/App.tsx             # async pick flow: fetch before dispatch       (Task 7)
src/ide/styles.css                     # dialog layout                                (Task 7)
e2e/scratch-library.spec.ts            # pick, run, save/reload, CDN failure          (Task 8)
public/library/LICENSE.md              # CC BY-SA attribution, corrected              (Task 8)
scripts/fetch-scratch-library.mjs      # DELETED — superseded                         (Task 8)
```

Tests are colocated (`foo.test.ts`), following the existing convention.

---

### Task 1: Catalog types, generator, and the generated catalog

**Files:**
- Create: `src/shared/scratchCatalog.ts`, `scripts/build-scratch-catalog.ts`, `public/library/scratch-catalog.json` (generated)
- Modify: `tsconfig.server.json`
- Test: `scripts/build-scratch-catalog.test.ts`

**Interfaces:**
- Produces: `ScratchCatalog`, `CatalogSprite`, `CatalogImage`, `CatalogSound` types; `buildCatalog(raw: RawCatalogs): ScratchCatalog`.
- Consumes: nothing.

**Why `src/shared/`:** the generator and the IDE must agree on the shape. `src/shared/projectSchema.ts` is already the precedent for a self-contained module the server imports (commit `3df3a37`). Keep `scratchCatalog.ts` import-free for the same reason.

- [ ] **Step 1: Write the failing test**

Create `scripts/build-scratch-catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildCatalog } from './build-scratch-catalog.ts'

const raw = {
  sprites: [
    {
      name: 'Abby',
      tags: ['people', 'person'],
      isStage: false,
      variables: {},
      blocks: { someBlockId: { opcode: 'event_whenflagclicked' } },
      costumes: [
        { assetId: 'a1', name: 'abby-a', bitmapResolution: 1, md5ext: 'a1.svg', dataFormat: 'svg', rotationCenterX: 31, rotationCenterY: 100 },
        { assetId: 'a2', name: 'abby-b', bitmapResolution: 1, md5ext: 'a2.svg', dataFormat: 'svg', rotationCenterX: 31, rotationCenterY: 100 },
      ],
      sounds: [{ assetId: 's1', name: 'pop', dataFormat: 'wav', md5ext: 's1.wav', sampleCount: 258, rate: 11025 }],
    },
  ],
  costumes: [
    { name: 'Abby-a', tags: ['people'], assetId: 'a1', bitmapResolution: 1, dataFormat: 'svg', md5ext: 'a1.svg', rotationCenterX: 31, rotationCenterY: 100 },
  ],
  backdrops: [
    { name: 'Arctic', tags: ['outdoors'], assetId: 'b1', bitmapResolution: 2, dataFormat: 'png', md5ext: 'b1.png', rotationCenterX: 480, rotationCenterY: 360 },
  ],
  sounds: [
    { name: 'A Bass', tags: ['music'], assetId: 'c1', dataFormat: '', md5ext: 'c1.wav', sampleCount: 56320, rate: 44100 },
  ],
}

describe('buildCatalog', () => {
  it('keeps sprite identity, tags, costumes and sounds', () => {
    const cat = buildCatalog(raw)
    expect(cat.sprites).toEqual([
      {
        name: 'Abby',
        tags: ['people', 'person'],
        costumes: [
          { name: 'abby-a', md5ext: 'a1.svg', res: 1 },
          { name: 'abby-b', md5ext: 'a2.svg', res: 1 },
        ],
        sounds: [{ name: 'pop', md5ext: 's1.wav' }],
      },
    ])
  })

  it('strips scratch block definitions and variables', () => {
    const json = JSON.stringify(buildCatalog(raw))
    expect(json).not.toContain('event_whenflagclicked')
    expect(json).not.toContain('blocks')
    expect(json).not.toContain('variables')
  })

  it('carries bitmapResolution as res, so retina art can be halved on load', () => {
    expect(buildCatalog(raw).backdrops[0]).toEqual({
      name: 'Arctic', tags: ['outdoors'], md5ext: 'b1.png', res: 2,
    })
  })

  it('defaults a missing bitmapResolution to 1', () => {
    const noRes = { ...raw, costumes: [{ ...raw.costumes[0], bitmapResolution: undefined }] }
    expect(buildCatalog(noRes).costumes[0].res).toBe(1)
  })

  it('precomputes sound duration from sampleCount and rate', () => {
    // 56320 / 44100 = 1.2770..., rounded to 2dp
    expect(buildCatalog(raw).sounds[0]).toEqual({
      name: 'A Bass', tags: ['music'], md5ext: 'c1.wav', seconds: 1.28,
    })
  })

  it('records the pinned source and the license', () => {
    const cat = buildCatalog(raw)
    expect(cat.source).toBe('scratch-gui@dae2a97a5bb0cd8a7513fafd60f9e7488f2a89a4')
    expect(cat.license).toBe('CC-BY-SA-4.0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/build-scratch-catalog.test.ts`
Expected: FAIL — cannot resolve `./build-scratch-catalog.ts`.

- [ ] **Step 3: Write the catalog types**

Create `src/shared/scratchCatalog.ts`. This file must import nothing — the generator, the IDE, and any future server code all read it.

```ts
/**
 * Shape of `public/library/scratch-catalog.json`, generated by
 * `scripts/build-scratch-catalog.ts` from Scratch's own library catalogs.
 *
 * Deliberately carries no width/height: Scratch's catalogs don't either, and a
 * cached dimension can disagree with the file it describes. Dimensions are
 * measured in the browser at fetch time. See docs/sprite_libraries.md.
 *
 * This module imports nothing so every consumer can read it — the same
 * constraint projectSchema.ts is under.
 */

/** A costume or backdrop. `res` is Scratch's bitmapResolution: 2 means retina. */
export interface CatalogImage {
  name: string
  tags: string[]
  md5ext: string
  res: number
}

/** A sound. `seconds` is precomputed from sampleCount/rate. */
export interface CatalogSound {
  name: string
  tags: string[]
  md5ext: string
  seconds: number
}

/** A sprite: a costume set plus the sounds Scratch ships with it. */
export interface CatalogSprite {
  name: string
  tags: string[]
  costumes: { name: string; md5ext: string; res: number }[]
  sounds: { name: string; md5ext: string }[]
}

export interface ScratchCatalog {
  /** `scratch-gui@<sha>` — the pinned commit the catalog was generated from. */
  source: string
  license: string
  sprites: CatalogSprite[]
  costumes: CatalogImage[]
  backdrops: CatalogImage[]
  sounds: CatalogSound[]
}

export const CATALOG_URL = '/library/scratch-catalog.json'
```

- [ ] **Step 4: Write the generator**

Create `scripts/build-scratch-catalog.ts`. `buildCatalog` is pure and exported for the test; `main()` runs only when the file is executed directly.

```ts
#!/usr/bin/env node
/**
 * Regenerates public/library/scratch-catalog.json from Scratch's library
 * catalogs. Downloads JSON only — never asset bytes; those are fetched from
 * the CDN at runtime, one at a time, as projects use them.
 *
 * Usage: node scripts/build-scratch-catalog.ts
 *
 * To pick up newly added Scratch assets, bump SCRATCH_GUI_SHA to a newer
 * scratch-gui commit and re-run. The SHA is pinned rather than tracking
 * `develop` so regeneration is reproducible.
 *
 * Scratch library media is CC BY-SA 4.0 — see public/library/LICENSE.md.
 */
import { writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type {
  CatalogImage, CatalogSound, CatalogSprite, ScratchCatalog,
} from '../src/shared/scratchCatalog.ts'

export const SCRATCH_GUI_SHA = 'dae2a97a5bb0cd8a7513fafd60f9e7488f2a89a4'
const CATALOG_BASE =
  `https://raw.githubusercontent.com/scratchfoundation/scratch-gui/${SCRATCH_GUI_SHA}/src/lib/libraries`

interface RawImage {
  name: string
  tags?: string[]
  md5ext: string
  bitmapResolution?: number
}
interface RawSound {
  name: string
  tags?: string[]
  md5ext: string
  sampleCount: number
  rate: number
}
interface RawSprite {
  name: string
  tags?: string[]
  costumes: RawImage[]
  sounds: RawSound[]
}
export interface RawCatalogs {
  sprites: RawSprite[]
  costumes: RawImage[]
  backdrops: RawImage[]
  sounds: RawSound[]
}

const image = (e: RawImage): CatalogImage => ({
  name: e.name,
  tags: e.tags ?? [],
  md5ext: e.md5ext,
  res: e.bitmapResolution ?? 1,
})

// Rounded to 2dp: this only ever labels a button ("1.28s"), and full float
// precision would bloat the catalog for no visible gain.
const sound = (e: RawSound): CatalogSound => ({
  name: e.name,
  tags: e.tags ?? [],
  md5ext: e.md5ext,
  seconds: Math.round((e.sampleCount / e.rate) * 100) / 100,
})

const sprite = (s: RawSprite): CatalogSprite => ({
  name: s.name,
  tags: s.tags ?? [],
  costumes: s.costumes.map(c => ({ name: c.name, md5ext: c.md5ext, res: c.bitmapResolution ?? 1 })),
  sounds: s.sounds.map(x => ({ name: x.name, md5ext: x.md5ext })),
})

/**
 * Pure transform. Drops `blocks` and `variables` — Scratch block definitions
 * our JavaScript engine can't interpret, and most of the catalog's bulk
 * (540 KB → 278 KB).
 */
export function buildCatalog(raw: RawCatalogs): ScratchCatalog {
  return {
    source: `scratch-gui@${SCRATCH_GUI_SHA}`,
    license: 'CC-BY-SA-4.0',
    sprites: raw.sprites.map(sprite),
    costumes: raw.costumes.map(image),
    backdrops: raw.backdrops.map(image),
    sounds: raw.sounds.map(sound),
  }
}

async function fetchCatalog<T>(name: string): Promise<T> {
  const res = await fetch(`${CATALOG_BASE}/${name}.json`)
  if (!res.ok) throw new Error(`Could not fetch ${name}.json: HTTP ${res.status}`)
  return (await res.json()) as T
}

async function main(): Promise<void> {
  const [sprites, costumes, backdrops, sounds] = await Promise.all([
    fetchCatalog<RawSprite[]>('sprites'),
    fetchCatalog<RawImage[]>('costumes'),
    fetchCatalog<RawImage[]>('backdrops'),
    fetchCatalog<RawSound[]>('sounds'),
  ])
  const catalog = buildCatalog({ sprites, costumes, backdrops, sounds })
  const out = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../public/library/scratch-catalog.json',
  )
  await writeFile(out, `${JSON.stringify(catalog)}\n`)
  console.log(
    `Wrote ${out}: ${catalog.sprites.length} sprites, ${catalog.costumes.length} costumes, ` +
      `${catalog.backdrops.length} backdrops, ${catalog.sounds.length} sounds.`,
  )
  console.log('Reminder: Scratch library media is CC BY-SA 4.0 — keep the attribution.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run scripts/build-scratch-catalog.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Typecheck the new scripts directory**

Modify `tsconfig.server.json` — change the last line from `"include": ["server"]` to:

```json
  "include": ["server", "scripts"]
```

Run: `npm run typecheck:server`
Expected: no errors. (`erasableSyntaxOnly` is on, so avoid enums and parameter properties — the code above already does.)

- [ ] **Step 7: Generate the real catalog**

Run: `node scripts/build-scratch-catalog.ts`
Expected output: `339 sprites, 886 costumes, 85 backdrops, 353 sounds`.

Verify the size is in the expected range (~278 KB):

```bash
ls -l public/library/scratch-catalog.json
```

- [ ] **Step 8: Commit**

```bash
git add src/shared/scratchCatalog.ts scripts/build-scratch-catalog.ts \
        scripts/build-scratch-catalog.test.ts public/library/scratch-catalog.json tsconfig.server.json
git commit -m "feat: generate a checked-in catalog of the whole Scratch library"
```

---

### Task 2: Fetching and measuring Scratch assets on demand

**Files:**
- Create: `src/ide/scratchAssets.ts`
- Test: `src/ide/scratchAssets.test.ts`

**Interfaces:**
- Consumes: `LoadedAsset`, `AssetStore` from `src/ide/library.ts`; `measureImage`, `downscale` from `src/ide/upload.ts`.
- Produces:
  - `scratchSource(md5ext: string): string` → `"scratch:<md5ext>"`
  - `scratchMd5Ext(source: string): string | null`
  - `assetUrl(md5ext: string): string`
  - `isSoundAsset(md5ext: string): boolean`
  - `fetchScratchAsset(md5ext, res, deps?): Promise<LoadedAsset>`
  - `class ScratchAssetLoader` with `load(md5ext, res): Promise<LoadedAsset>` and `loadMany(items): Promise<AssetStore>`

- [ ] **Step 1: Write the failing test**

Create `src/ide/scratchAssets.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  ScratchAssetLoader, assetUrl, fetchScratchAsset, isSoundAsset, scratchMd5Ext, scratchSource,
} from './scratchAssets'

const okFetch = async () => ({ ok: true, blob: async () => 'BLOB' }) as unknown as Response
const toDataUrl = async (blob: unknown) => `data:fake,${String(blob)}`
const measure = async () => ({ width: 120, height: 80 })

describe('scratch refs', () => {
  it('round-trips a source and an md5ext', () => {
    expect(scratchSource('a1.svg')).toBe('scratch:a1.svg')
    expect(scratchMd5Ext('scratch:a1.svg')).toBe('a1.svg')
  })

  it('ignores refs belonging to other schemes', () => {
    expect(scratchMd5Ext('library:cat-a')).toBeNull()
    expect(scratchMd5Ext('data:image/png;base64,xyz')).toBeNull()
  })

  it('builds the CDN url with its trailing slash', () => {
    expect(assetUrl('a1.svg')).toBe('https://assets.scratch.mit.edu/internalapi/asset/a1.svg/get/')
  })

  it('decides sound-ness from the extension, never from dataFormat', () => {
    expect(isSoundAsset('c1.wav')).toBe(true)
    expect(isSoundAsset('a1.svg')).toBe(false)
    expect(isSoundAsset('b1.png')).toBe(false)
  })
})

describe('fetchScratchAsset', () => {
  it('fetches, converts to a data url, and measures an image', async () => {
    expect(await fetchScratchAsset('a1.svg', 1, { fetchFn: okFetch, toDataUrl, measure })).toEqual({
      dataUrl: 'data:fake,BLOB', width: 120, height: 80,
    })
  })

  it('halves retina art, so a 960x720 res-2 backdrop lands at 480x360', async () => {
    const bigMeasure = async () => ({ width: 960, height: 720 })
    expect(
      await fetchScratchAsset('b1.png', 2, { fetchFn: okFetch, toDataUrl, measure: bigMeasure }),
    ).toEqual({ dataUrl: 'data:fake,BLOB', width: 480, height: 360 })
  })

  it('caps oversized art at the stage size, like uploads do', async () => {
    const hugeMeasure = async () => ({ width: 1920, height: 1080 })
    const asset = await fetchScratchAsset('a1.svg', 1, { fetchFn: okFetch, toDataUrl, measure: hugeMeasure })
    expect(asset.width).toBeLessThanOrEqual(480)
    expect(asset.height).toBeLessThanOrEqual(360)
  })

  it('never measures a sound, and records it with no dimensions', async () => {
    const measureSpy = vi.fn(measure)
    expect(
      await fetchScratchAsset('c1.wav', 1, { fetchFn: okFetch, toDataUrl, measure: measureSpy }),
    ).toEqual({ dataUrl: 'data:fake,BLOB', width: 0, height: 0 })
    expect(measureSpy).not.toHaveBeenCalled()
  })

  it('reports a failed download in words a kid can act on', async () => {
    const badFetch = async () => ({ ok: false, status: 503 }) as unknown as Response
    await expect(
      fetchScratchAsset('a1.svg', 1, { fetchFn: badFetch, toDataUrl, measure }),
    ).rejects.toThrow(/couldn't be downloaded/i)
  })
})

describe('ScratchAssetLoader', () => {
  it('shares one in-flight request across concurrent callers', async () => {
    const fetchFn = vi.fn(okFetch)
    const loader = new ScratchAssetLoader({ fetchFn, toDataUrl, measure })
    const [a, b] = await Promise.all([loader.load('a1.svg', 1), loader.load('a1.svg', 1)])
    expect(a).toEqual(b)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('does not re-fetch an asset it already has', async () => {
    const fetchFn = vi.fn(okFetch)
    const loader = new ScratchAssetLoader({ fetchFn, toDataUrl, measure })
    await loader.load('a1.svg', 1)
    await loader.load('a1.svg', 1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('forgets a failed load so a retry can succeed', async () => {
    let attempt = 0
    const flaky = async () => {
      attempt += 1
      if (attempt === 1) return { ok: false, status: 500 } as unknown as Response
      return { ok: true, blob: async () => 'BLOB' } as unknown as Response
    }
    const loader = new ScratchAssetLoader({ fetchFn: flaky, toDataUrl, measure })
    await expect(loader.load('a1.svg', 1)).rejects.toThrow()
    expect((await loader.load('a1.svg', 1)).dataUrl).toBe('data:fake,BLOB')
  })

  it('loadMany returns a store keyed by scratch: source', async () => {
    const loader = new ScratchAssetLoader({ fetchFn: okFetch, toDataUrl, measure })
    const store = await loader.loadMany([{ md5ext: 'a1.svg', res: 1 }, { md5ext: 'c1.wav', res: 1 }])
    expect(store.get('scratch:a1.svg')).toEqual({ dataUrl: 'data:fake,BLOB', width: 120, height: 80 })
    expect(store.get('scratch:c1.wav')).toEqual({ dataUrl: 'data:fake,BLOB', width: 0, height: 0 })
    expect(store.size).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ide/scratchAssets.test.ts`
Expected: FAIL — cannot resolve `./scratchAssets`.

- [ ] **Step 3: Write the implementation**

Create `src/ide/scratchAssets.ts`:

```ts
import type { AssetStore, LoadedAsset } from './library'
import { downscale, measureImage, type Dimensions } from './upload'

const CDN = 'https://assets.scratch.mit.edu/internalapi/asset'
const PREFIX = 'scratch:'

/**
 * Sounds are the only non-image assets in Scratch's library, and the catalog's
 * `dataFormat` field is unreliable — it is the empty string for some sounds
 * (e.g. "A Bass"). The extension on md5ext is the one thing always present.
 */
const SOUND_EXTENSIONS = ['.wav', '.mp3']

export function scratchSource(md5ext: string): string {
  return `${PREFIX}${md5ext}`
}

export function scratchMd5Ext(source: string): string | null {
  return source.startsWith(PREFIX) ? source.slice(PREFIX.length) : null
}

/** The trailing slash is required; without it the CDN 404s. */
export function assetUrl(md5ext: string): string {
  return `${CDN}/${md5ext}/get/`
}

export function isSoundAsset(md5ext: string): boolean {
  return SOUND_EXTENSIONS.some(ext => md5ext.toLowerCase().endsWith(ext))
}

export interface FetchDeps {
  fetchFn: (url: string) => Promise<Response>
  toDataUrl: (blob: Blob) => Promise<string>
  measure: (dataUrl: string) => Promise<Dimensions>
}

const defaultDeps: FetchDeps = {
  fetchFn: (url: string) => fetch(url),
  toDataUrl: blobToDataUrl,
  measure: measureImage,
}

/**
 * Downloads one Scratch asset and describes it.
 *
 * `res` is the catalog's bitmapResolution. Scratch stores retina art at twice
 * its display size, so the measured pixels are divided by it — the Arctic
 * backdrop is a 960×720 PNG that must render at 480×360. The same downscale
 * cap uploads use is then applied, so no library asset can be larger than the
 * stage.
 */
export async function fetchScratchAsset(
  md5ext: string,
  res: number,
  deps: FetchDeps = defaultDeps,
): Promise<LoadedAsset> {
  const response = await deps.fetchFn(assetUrl(md5ext))
  if (!response.ok) {
    throw new Error(
      `"${md5ext}" couldn't be downloaded from the Scratch library (HTTP ${response.status}).`,
    )
  }
  const dataUrl = await deps.toDataUrl(await response.blob())

  // A sound never decodes as an <Image>; it has a duration, not dimensions.
  if (isSoundAsset(md5ext)) return { dataUrl, width: 0, height: 0 }

  const natural = await deps.measure(dataUrl)
  const size = downscale(natural.width / (res || 1), natural.height / (res || 1))
  return { dataUrl, ...size }
}

/**
 * Caches loaded assets and collapses concurrent requests for the same one.
 *
 * Both matter at this scale: adding a sprite fetches its whole costume set at
 * once, and 197 different Scratch sprites carry the same "pop" sound. A failed
 * load is dropped from the cache so Retry can actually retry.
 */
export class ScratchAssetLoader {
  private inFlight = new Map<string, Promise<LoadedAsset>>()

  constructor(private deps: FetchDeps = defaultDeps) {}

  load(md5ext: string, res: number): Promise<LoadedAsset> {
    const existing = this.inFlight.get(md5ext)
    if (existing) return existing
    const promise = fetchScratchAsset(md5ext, res, this.deps).catch((err: unknown) => {
      this.inFlight.delete(md5ext)
      throw err
    })
    this.inFlight.set(md5ext, promise)
    return promise
  }

  /** Loads a set of assets into a store keyed the way AssetRef.source is. */
  async loadMany(items: { md5ext: string; res: number }[]): Promise<AssetStore> {
    const pairs = await Promise.all(
      items.map(async i => [scratchSource(i.md5ext), await this.load(i.md5ext, i.res)] as const),
    )
    return new Map(pairs)
  }
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

- [ ] **Step 4: Export `Dimensions` if it is not already**

`src/ide/upload.ts` already declares `export interface Dimensions`. Confirm with:

Run: `grep -n "export interface Dimensions" src/ide/upload.ts`
Expected: one match. If missing, add `export` to it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/ide/scratchAssets.test.ts && npm run build`
Expected: 12 tests PASS, build clean.

- [ ] **Step 6: Commit**

```bash
git add src/ide/scratchAssets.ts src/ide/scratchAssets.test.ts
git commit -m "feat: fetch and measure Scratch CDN assets on demand"
```

---

### Task 3: Unique asset names when adding to a project

**Files:**
- Modify: `src/shared/project.ts`
- Test: `src/shared/project.test.ts`

**Interfaces:**
- Produces: `uniqueAssetName(taken: string[], desired: string): string`; `addSprite` now de-duplicates costume names within the sprite; `addSound`/`addBackdrop` de-duplicate against existing entries.
- Consumes: nothing new.

**Why this is correctness, not tidiness:** user code addresses assets by name — `playSound("meow")`, `stage.switchBackdrop("night")`. `stageModel.ts:12` looks a backdrop up by `name`, and `scene.ts:162` looks a sound up by `name`. Scratch's own `Shark 2` sprite carries **two different sounds both named `Water drop`**, and `Goal Cheer` and `Referee Whistle` each name two distinct assets. Without this, `playSound("Water drop")` silently picks one.

- [ ] **Step 1: Write the failing test**

Append to `src/shared/project.test.ts`:

```ts
describe('unique asset names', () => {
  it('suffixes a colliding sound name instead of shadowing the first', () => {
    let p = createEmptyProject()
    p = addSound(p, { name: 'Water drop', source: 'scratch:a.wav' })
    p = addSound(p, { name: 'Water drop', source: 'scratch:b.wav' })
    expect(p.sounds.map(s => s.name)).toEqual(['Water drop', 'Water drop2'])
  })

  it('still collapses the same asset added twice', () => {
    let p = createEmptyProject()
    p = addSound(p, { name: 'pop', source: 'scratch:same.wav' })
    p = addSound(p, { name: 'pop', source: 'scratch:same.wav' })
    expect(p.sounds).toHaveLength(1)
  })

  it('suffixes a colliding backdrop name', () => {
    let p = createEmptyProject()
    p = addBackdrop(p, { name: 'blue-sky', source: 'scratch:other.svg' })
    expect(p.stage.backdrops.map(b => b.name)).toEqual(['blue-sky', 'blue-sky2'])
  })

  it('still switches to an existing backdrop rather than adding it twice', () => {
    let p = createEmptyProject()
    p = addBackdrop(p, { name: 'night', source: 'scratch:n.svg' })
    p = addBackdrop(p, { name: 'night', source: 'scratch:n.svg' })
    expect(p.stage.backdrops).toHaveLength(2)
    expect(p.stage.currentBackdrop).toBe(1)
  })

  it('de-duplicates costume names within one sprite', () => {
    const p = addSprite(createEmptyProject(), 'Shark', [
      { name: 'shark-a', source: 'scratch:1.svg' },
      { name: 'shark-a', source: 'scratch:2.svg' },
    ])
    expect(p.sprites[0].costumes.map(c => c.name)).toEqual(['shark-a', 'shark-a2'])
  })
})
```

Make sure `addBackdrop`, `addSound`, `addSprite`, `createEmptyProject` are in the file's import list at the top.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/project.test.ts`
Expected: FAIL — names come back as `['Water drop', 'Water drop']`.

- [ ] **Step 3: Implement**

In `src/shared/project.ts`, add the helper below `uniqueSpriteName`:

```ts
/**
 * User code addresses costumes, backdrops, and sounds by name —
 * `playSound("meow")`, `stage.switchBackdrop("night")`. Two assets sharing a
 * name make that call ambiguous, and the Scratch library is full of real
 * collisions: `pop` is attached to 197 different sprites, and `Shark 2` alone
 * carries two distinct sounds both called `Water drop`. Suffix the newcomer
 * rather than letting one silently shadow the other.
 */
export function uniqueAssetName(taken: string[], desired: string): string {
  const used = new Set(taken)
  if (!used.has(desired)) return desired
  let n = 2
  while (used.has(`${desired}${n}`)) n++
  return `${desired}${n}`
}
```

Replace `addSprite`, `addBackdrop`, and `addSound` with:

```ts
export function addSprite(project: Project, name: string, costumes: AssetRef[]): Project {
  const unique: AssetRef[] = []
  for (const costume of costumes) {
    unique.push({ ...costume, name: uniqueAssetName(unique.map(c => c.name), costume.name) })
  }
  const sprite: SpriteDef = {
    name,
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    visible: true,
    costumes: unique,
    currentCostume: 0,
    script: '',
  }
  return { ...project, sprites: [...project.sprites, sprite] }
}

export function addBackdrop(project: Project, ref: AssetRef): Project {
  const existing = project.stage.backdrops.findIndex(b => b.source === ref.source)
  if (existing !== -1) {
    return { ...project, stage: { ...project.stage, currentBackdrop: existing } }
  }
  const named = {
    ...ref,
    name: uniqueAssetName(project.stage.backdrops.map(b => b.name), ref.name),
  }
  const backdrops = [...project.stage.backdrops, named]
  return { ...project, stage: { backdrops, currentBackdrop: backdrops.length - 1 } }
}

export function addSound(project: Project, ref: AssetRef): Project {
  if (project.sounds.some(s => s.source === ref.source)) return project
  const named = { ...ref, name: uniqueAssetName(project.sounds.map(s => s.name), ref.name) }
  return { ...project, sounds: [...project.sounds, named] }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/project.test.ts src/ide/store.test.ts`
Expected: PASS. `store.test.ts` runs too because its reducer delegates to these functions.

- [ ] **Step 5: Commit**

```bash
git add src/shared/project.ts src/shared/project.test.ts
git commit -m "fix: keep costume, backdrop, and sound names unique within a project"
```

---

### Task 4: Key backdrops and sounds by identity in the stage

**Files:**
- Modify: `src/runtime-host/textureKeys.ts`, `src/runtime-host/scene.ts:40-51`, `src/runtime-host/scene.ts:53-57`, `src/runtime-host/scene.ts:161-166`, `docs/TODO.md:25`
- Test: `src/runtime-host/textureKeys.test.ts`

**Interfaces:**
- Consumes: `RunPayload` from `src/shared/protocol.ts`.
- Produces: `TextureIndex` gains `byBackdrop: Map<string, string>` and `bySound: Map<string, string>`, both name → key.

**Why:** `buildTextureIndex` already keys sprite costumes by `dataUrl`, but `scene.ts:48` still loads backdrops under `b.name` and `scene.ts:50` maps sounds by `s.name`. This is the item parked at `docs/TODO.md:25`. Task 3 makes names unique *within a project*, and this closes the same hole at the render layer.

- [ ] **Step 1: Write the failing test**

Append to `src/runtime-host/textureKeys.test.ts`:

```ts
describe('backdrop and sound identity', () => {
  const payload = {
    sprites: [],
    backdrops: [
      { name: 'sky', width: 480, height: 360, dataUrl: 'data:A' },
      { name: 'sky2', width: 480, height: 360, dataUrl: 'data:B' },
    ],
    currentBackdrop: 0,
    sounds: [
      { name: 'Water drop', dataUrl: 'data:C' },
      { name: 'Water drop2', dataUrl: 'data:D' },
    ],
    mainScript: '',
  } as unknown as RunPayload

  it('gives every distinct backdrop its own texture key', () => {
    const index = buildTextureIndex(payload)
    expect(index.byBackdrop.get('sky')).not.toBe(index.byBackdrop.get('sky2'))
  })

  it('reuses one key for two backdrops sharing the same bytes', () => {
    const same = {
      ...payload,
      backdrops: [
        { name: 'a', width: 1, height: 1, dataUrl: 'data:A' },
        { name: 'b', width: 1, height: 1, dataUrl: 'data:A' },
      ],
    } as unknown as RunPayload
    const index = buildTextureIndex(same)
    expect(index.byBackdrop.get('a')).toBe(index.byBackdrop.get('b'))
  })

  it('does not let a backdrop key collide with a costume key', () => {
    const withSprite = {
      ...payload,
      sprites: [{ name: 'Cat', costumes: [{ name: 'sky', width: 1, height: 1, dataUrl: 'data:Z' }] }],
    } as unknown as RunPayload
    const index = buildTextureIndex(withSprite)
    expect(index.bySprite.get('Cat')?.get('sky')).not.toBe(index.byBackdrop.get('sky'))
  })

  it('maps each sound name to its own data url', () => {
    const index = buildTextureIndex(payload)
    expect(index.bySound.get('Water drop')).toBe('data:C')
    expect(index.bySound.get('Water drop2')).toBe('data:D')
  })
})
```

Ensure the file imports `RunPayload` as a type at the top:
`import type { RunPayload } from '../shared/protocol'`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runtime-host/textureKeys.test.ts`
Expected: FAIL — `index.byBackdrop` is undefined.

- [ ] **Step 3: Implement**

In `src/runtime-host/textureKeys.ts`, extend the interface and the builder:

```ts
export interface TextureIndex {
  /** Every distinct costume `dataUrl` in the payload, mapped to a stable, unique Phaser texture key. */
  keyForDataUrl: Map<string, string>
  /** sprite name -> costume name -> texture key, for resolving a snapshot's costume name back to art. */
  bySprite: Map<string, Map<string, string>>
  /** backdrop name -> texture key. */
  byBackdrop: Map<string, string>
  /** sound name -> data url. */
  bySound: Map<string, string>
}
```

Inside `buildTextureIndex`, after the sprite loop and before the return:

```ts
  const byBackdrop = new Map<string, string>()
  for (const backdrop of payload.backdrops) byBackdrop.set(backdrop.name, keyFor(backdrop.dataUrl))

  // Sounds need no Phaser texture — they're played as <Audio> — but they get
  // the same by-name-to-identity indirection so a name can never resolve to
  // the wrong bytes.
  const bySound = new Map<string, string>()
  for (const sound of payload.sounds) bySound.set(sound.name, sound.dataUrl)

  return { keyForDataUrl, bySprite, byBackdrop, bySound }
```

- [ ] **Step 4: Wire the scene to the index**

In `src/runtime-host/scene.ts`, replace the backdrop and sound lines in `preload()`:

```ts
    for (const b of this.payload.backdrops) {
      const key = this.textureIndex.byBackdrop.get(b.name)
      if (key && !this.textures.exists(key)) this.load.image(key, b.dataUrl)
    }
    for (const [name, dataUrl] of this.textureIndex.bySound) this.audio.set(name, dataUrl)
```

In `create()`, resolve the starting backdrop through the index:

```ts
    const startName = this.payload.backdrops[this.payload.currentBackdrop]?.name ?? ''
    this.backdrop = this.add
      .image(STAGE_WIDTH / 2, STAGE_HEIGHT / 2, this.textureIndex.byBackdrop.get(startName) ?? '')
      .setDepth(-1000)
      .setDisplaySize(STAGE_WIDTH, STAGE_HEIGHT)
```

There is a third site. `render()` at lines 101-102 feeds the snapshot's backdrop **name** straight into `setTexture`, so a backdrop switch at runtime re-introduces the very collision this task removes. Replace it with:

```ts
    const wanted = snap.backdrop ? this.textureIndex.byBackdrop.get(snap.backdrop) : null
    if (this.backdrop && wanted && this.backdrop.texture.key !== wanted) {
      this.backdrop.setTexture(wanted).setDisplaySize(STAGE_WIDTH, STAGE_HEIGHT)
    }
```

Confirm no name-as-key uses remain — every hit should now go through `byBackdrop`:

Run: `grep -n "backdrop" src/runtime-host/scene.ts`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run && npm run build`
Expected: all unit tests PASS, build clean.

- [ ] **Step 6: Verify on the real stage**

Run: `npx playwright test e2e/ide.spec.ts`
Expected: PASS — the existing suite already covers backdrop switching and sounds.

- [ ] **Step 7: Tick the TODO**

In `docs/TODO.md`, change line 25 from `- [ ] Backdrops and sounds are still keyed by name…` to `- [x]`, and append: ` Fixed by keying both through `buildTextureIndex` (`src/runtime-host/textureKeys.ts`), alongside unique-naming in `src/shared/project.ts`.`

- [ ] **Step 8: Commit**

```bash
git add src/runtime-host/textureKeys.ts src/runtime-host/textureKeys.test.ts \
        src/runtime-host/scene.ts docs/TODO.md
git commit -m "fix: key backdrops and sounds by asset identity, not by name"
```

---

### Task 5: Loading, searching, and filtering the catalog

**Files:**
- Create: `src/ide/catalogSearch.ts`
- Test: `src/ide/catalogSearch.test.ts`

**Interfaces:**
- Consumes: `ScratchCatalog`, `CatalogImage`, `CatalogSound`, `CatalogSprite`, `CATALOG_URL` from `src/shared/scratchCatalog.ts`.
- Produces:
  - `loadCatalog(fetchFn?): Promise<ScratchCatalog>`
  - `type CatalogKind = 'sprite' | 'costume' | 'backdrop' | 'sound'`
  - `type CatalogItem = CatalogSprite | CatalogImage | CatalogSound`
  - `itemsOfKind(catalog, kind): CatalogItem[]`
  - `searchItems(items, query, tag): CatalogItem[]`
  - `TAG_CHIPS: string[]`

- [ ] **Step 1: Write the failing test**

Create `src/ide/catalogSearch.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TAG_CHIPS, itemsOfKind, loadCatalog, searchItems } from './catalogSearch'
import type { ScratchCatalog } from '../shared/scratchCatalog'

const catalog: ScratchCatalog = {
  source: 'scratch-gui@test',
  license: 'CC-BY-SA-4.0',
  sprites: [
    { name: 'Abby', tags: ['people'], costumes: [{ name: 'abby-a', md5ext: 'a1.svg', res: 1 }], sounds: [] },
    { name: 'Cat', tags: ['animals'], costumes: [{ name: 'cat-a', md5ext: 'c1.svg', res: 1 }], sounds: [] },
  ],
  costumes: [{ name: 'Ball', tags: ['sports'], md5ext: 'b1.svg', res: 1 }],
  backdrops: [{ name: 'Arctic', tags: ['outdoors', 'ice'], md5ext: 'd1.png', res: 2 }],
  sounds: [{ name: 'Meow', tags: ['animals'], md5ext: 'e1.wav', seconds: 0.85 }],
}

describe('itemsOfKind', () => {
  it('returns the list matching the kind', () => {
    expect(itemsOfKind(catalog, 'sprite')).toHaveLength(2)
    expect(itemsOfKind(catalog, 'backdrop')[0].name).toBe('Arctic')
    expect(itemsOfKind(catalog, 'sound')[0].name).toBe('Meow')
  })
})

describe('searchItems', () => {
  const sprites = itemsOfKind(catalog, 'sprite')

  it('returns everything when there is no query or tag', () => {
    expect(searchItems(sprites, '', null)).toHaveLength(2)
  })

  it('matches on name, case-insensitively', () => {
    expect(searchItems(sprites, 'abb', null).map(i => i.name)).toEqual(['Abby'])
  })

  it('matches on tag text too, so "animals" finds the Cat', () => {
    expect(searchItems(sprites, 'animals', null).map(i => i.name)).toEqual(['Cat'])
  })

  it('filters by a selected tag chip', () => {
    expect(searchItems(sprites, '', 'people').map(i => i.name)).toEqual(['Abby'])
  })

  it('applies query and tag together', () => {
    expect(searchItems(sprites, 'cat', 'people')).toEqual([])
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(searchItems(sprites, '  cat  ', null).map(i => i.name)).toEqual(['Cat'])
  })
})

describe('loadCatalog', () => {
  it('loads the catalog as json', async () => {
    const fetchFn = async () => ({ ok: true, json: async () => catalog }) as unknown as Response
    expect(await loadCatalog(fetchFn)).toEqual(catalog)
  })

  it('rejects a failed fetch with the status', async () => {
    const fetchFn = async () => ({ ok: false, status: 404 }) as unknown as Response
    await expect(loadCatalog(fetchFn)).rejects.toThrow(/404/)
  })
})

describe('TAG_CHIPS', () => {
  it('offers a short curated set, not all 379 tags', () => {
    expect(TAG_CHIPS.length).toBeLessThanOrEqual(10)
    expect(TAG_CHIPS).toContain('animals')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ide/catalogSearch.test.ts`
Expected: FAIL — cannot resolve `./catalogSearch`.

- [ ] **Step 3: Implement**

Create `src/ide/catalogSearch.ts`:

```ts
import {
  CATALOG_URL,
  type CatalogImage, type CatalogSound, type CatalogSprite, type ScratchCatalog,
} from '../shared/scratchCatalog'

export type CatalogKind = 'sprite' | 'costume' | 'backdrop' | 'sound'
export type CatalogItem = CatalogSprite | CatalogImage | CatalogSound

/**
 * The catalog has 379 distinct tags, which is a wall of chips rather than a
 * way in. These are the broadest ones by entry count, in an order that reads
 * like a kid's mental categories rather than a frequency table.
 */
export const TAG_CHIPS = [
  'animals', 'people', 'fantasy', 'sports', 'food', 'space', 'music', 'effects', 'outdoors',
]

export async function loadCatalog(
  fetchFn: (url: string) => Promise<Response> = fetch,
): Promise<ScratchCatalog> {
  const res = await fetchFn(CATALOG_URL)
  if (!res.ok) throw new Error(`Could not load the Scratch library (HTTP ${res.status}).`)
  return (await res.json()) as ScratchCatalog
}

export function itemsOfKind(catalog: ScratchCatalog, kind: CatalogKind): CatalogItem[] {
  switch (kind) {
    case 'sprite': return catalog.sprites
    case 'costume': return catalog.costumes
    case 'backdrop': return catalog.backdrops
    case 'sound': return catalog.sounds
  }
}

/**
 * Name-or-tag substring match, plus an optional tag chip. Searching tags is
 * what makes "animals" find the Cat — Scratch's own dialog behaves this way,
 * and without it a kid has to already know an asset's name to find it.
 */
export function searchItems(
  items: CatalogItem[],
  query: string,
  tag: string | null,
): CatalogItem[] {
  const q = query.trim().toLowerCase()
  return items.filter(item => {
    if (tag && !item.tags.includes(tag)) return false
    if (!q) return true
    return (
      item.name.toLowerCase().includes(q) || item.tags.some(t => t.toLowerCase().includes(q))
    )
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ide/catalogSearch.test.ts`
Expected: 11 tests PASS.

- [ ] **Step 5: Verify the chips actually exist in the real catalog**

Run:

```bash
node -e "const c=require('./public/library/scratch-catalog.json');
const all=new Set([...c.sprites,...c.costumes,...c.backdrops,...c.sounds].flatMap(e=>e.tags));
for (const t of ['animals','people','fantasy','sports','food','space','music','effects','outdoors'])
  console.log(t, all.has(t) ? 'ok' : 'MISSING')"
```

Expected: every chip prints `ok`. Replace any that print `MISSING` with a tag that exists, and update the test.

- [ ] **Step 6: Commit**

```bash
git add src/ide/catalogSearch.ts src/ide/catalogSearch.test.ts
git commit -m "feat: load, search, and tag-filter the Scratch catalog"
```

---

### Task 6: Resolve `scratch:` refs when a saved game opens

**Files:**
- Modify: `src/ide/rehydrate.ts`
- Test: `src/ide/rehydrate.test.ts`

**Interfaces:**
- Consumes: `ScratchAssetLoader` (Task 2), `scratchMd5Ext` (Task 2).
- Produces: `rehydrateAssetStore(project, measure?, loader?)` — same `RehydrateResult`, now also covering `scratch:` sources.

**Why:** `rehydrate.ts` resolves `data:` uploads and deliberately skips `library:` refs because `preloadLibrary` covered those. A `scratch:` ref is covered by neither, so without this a reloaded game throws `Asset "scratch:…" has not been loaded.` at the first Run.

Note the ref carries no `res`. Passing `1` is correct: `downscale` still caps the result, and the only assets where `res` matters are `res: 2` backdrops, which are 960×720 and get capped to 480×360 by `downscale` anyway — the same number either path.

- [ ] **Step 1: Write the failing test**

Append to `src/ide/rehydrate.test.ts`:

```ts
describe('scratch refs', () => {
  const project = {
    version: 1,
    name: 'g',
    sprites: [{
      name: 'Abby', x: 0, y: 0, size: 100, direction: 90, visible: true,
      costumes: [{ name: 'abby-a', source: 'scratch:a1.svg' }],
      currentCostume: 0, script: '',
    }],
    stage: { backdrops: [{ name: 'blue-sky', source: 'library:blue-sky' }], currentBackdrop: 0 },
    sounds: [{ name: 'pop', source: 'scratch:s1.wav' }],
    mainScript: '',
  } as unknown as Project

  const fakeLoader = {
    load: async (md5ext: string) => ({ dataUrl: `data:fake,${md5ext}`, width: 10, height: 20 }),
  }

  it('fetches every scratch asset the project references', async () => {
    const { additions, issues } = await rehydrateAssetStore(project, measureStub, fakeLoader)
    expect(issues).toEqual([])
    expect(additions.get('scratch:a1.svg')).toEqual({ dataUrl: 'data:fake,a1.svg', width: 10, height: 20 })
    expect(additions.get('scratch:s1.wav')).toEqual({ dataUrl: 'data:fake,s1.wav', width: 10, height: 20 })
  })

  it('leaves library refs to preloadLibrary', async () => {
    const { additions } = await rehydrateAssetStore(project, measureStub, fakeLoader)
    expect(additions.has('library:blue-sky')).toBe(false)
  })

  it('reports a failed download and still opens the rest of the game', async () => {
    const failing = {
      load: async (md5ext: string) => {
        if (md5ext === 'a1.svg') throw new Error('offline')
        return { dataUrl: 'data:fake,ok', width: 1, height: 1 }
      },
    }
    const { additions, issues } = await rehydrateAssetStore(project, measureStub, failing)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/Scratch library/i)
    expect(additions.has('scratch:s1.wav')).toBe(true)
  })
})
```

Add `const measureStub = async () => ({ width: 4, height: 4 })` near the top of the file if the existing tests don't already define an equivalent, and make sure `Project` is imported as a type.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ide/rehydrate.test.ts`
Expected: FAIL — `rehydrateAssetStore` takes two parameters and returns no `scratch:` entries.

- [ ] **Step 3: Implement**

In `src/ide/rehydrate.ts`, add the imports:

```ts
import { ScratchAssetLoader, scratchMd5Ext } from './scratchAssets'
import type { LoadedAsset } from './library'
```

Define the injectable shape and widen the signature:

```ts
/** Just the part of ScratchAssetLoader this needs — keeps the test's stub small. */
export interface AssetLoading {
  load(md5ext: string, res: number): Promise<LoadedAsset>
}

export async function rehydrateAssetStore(
  project: Project,
  measure: typeof measureImage = measureImage,
  loader: AssetLoading = new ScratchAssetLoader(),
): Promise<RehydrateResult> {
```

Collect `scratch:` sources alongside the `data:` ones. Replace the three collection loops with:

```ts
  const sources = new Set<string>()
  const scratchSources = new Set<string>()
  const collect = (source: string) => {
    if (source.startsWith('data:')) sources.add(source)
    else if (scratchMd5Ext(source) !== null) scratchSources.add(source)
  }
  for (const sprite of project.sprites) {
    for (const costume of sprite.costumes) collect(costume.source)
  }
  for (const backdrop of project.stage.backdrops) collect(backdrop.source)
  for (const sound of project.sounds) collect(sound.source)
```

Then, after the existing `await Promise.all(...)` over `sources`, add a second pass:

```ts
  // `res` is unknown here — the ref carries identity only. Passing 1 is safe:
  // the only assets where it matters are res-2 backdrops, which are 960×720
  // and land at 480×360 through `downscale` either way.
  await Promise.all(
    [...scratchSources].map(async source => {
      const md5ext = scratchMd5Ext(source)!
      try {
        additions.set(source, await loader.load(md5ext, 1))
      } catch (err) {
        issues.push({
          message: `Couldn't load "${md5ext}" from the Scratch library: ${
            err instanceof Error ? err.message : String(err)
          }`,
        })
      }
    }),
  )
```

Finally, extend the module docblock: after the sentence about `library:` refs being covered by `preloadLibrary`, add that `scratch:` refs are fetched here from the CDN, and that one unreachable asset is reported and skipped rather than sinking the whole game.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ide/rehydrate.test.ts && npm run build`
Expected: PASS, build clean.

- [ ] **Step 5: Commit**

```bash
git add src/ide/rehydrate.ts src/ide/rehydrate.test.ts
git commit -m "feat: fetch scratch assets when opening a saved game"
```

---

### Task 7: The library dialog

**Files:**
- Modify: `src/ide/components/LibraryDialog.tsx` (full rewrite), `src/ide/components/App.tsx:55-73,134-143`, `src/ide/styles.css`
- Test: covered by Task 5's unit tests and Task 8's e2e (no jsdom — existing convention)

**Interfaces:**
- Consumes: `loadCatalog`, `itemsOfKind`, `searchItems`, `TAG_CHIPS`, `CatalogKind` (Task 5); `ScratchAssetLoader`, `scratchSource`, `isSoundAsset` (Task 2); `LibraryEntry`, `LibraryManifest`, `AssetStore` (existing).
- Produces: `LibraryDialog` with props `{ manifest, catalog, store, loader, kind, onPickLocal, onPickScratch, onUpload, onClose }`.

**Behavior the e2e in Task 8 will assert:**
- Tabs switch the kind; the local ten appear first under a "Built in" heading, the Scratch catalog under "From Scratch".
- The search box filters as you type; tag chips filter; both together narrow.
- Thumbnails load only when scrolled into view.
- Picking shows a busy state and closes only once the bytes are in the store.
- A CDN failure leaves the dialog open with an error and a Retry.

- [ ] **Step 1: Load the catalog alongside the manifest in App**

In `src/ide/components/App.tsx`, extend the existing library-loading effect (lines 55-73). Keep `preloadLibrary(m)` — it now only covers the ten local assets, so startup stays instant.

```tsx
  const [catalog, setCatalog] = useState<ScratchCatalog | null>(null)
  const loader = useMemo(() => new ScratchAssetLoader(), [])

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
```

Add the imports at the top:

```tsx
import { loadCatalog } from '../catalogSearch'
import { ScratchAssetLoader, scratchSource } from '../scratchAssets'
import type { ScratchCatalog, CatalogImage, CatalogSound, CatalogSprite } from '../../shared/scratchCatalog'
```

- [ ] **Step 2: Make picking async, fetching before dispatching**

Replace `pickFromLibrary` (lines 134-143) with the local-pick handler plus a new Scratch handler. The fetch must complete *before* the dispatch, or `makeResolver` throws at Run.

```tsx
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
  const pickFromScratch = async (item: CatalogSprite | CatalogImage | CatalogSound) => {
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
```

Pass both handlers plus `catalog` and `loader` down where `<LibraryDialog … />` is rendered (around line 290).

- [ ] **Step 3: Rewrite the dialog**

Replace `src/ide/components/LibraryDialog.tsx` entirely:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssetStore, LibraryEntry, LibraryManifest } from '../library'
import {
  TAG_CHIPS, itemsOfKind, searchItems, type CatalogItem, type CatalogKind,
} from '../catalogSearch'
import type { ScratchAssetLoader } from '../scratchAssets'
import type { ScratchCatalog } from '../../shared/scratchCatalog'

interface Props {
  manifest: LibraryManifest
  catalog: ScratchCatalog | null
  store: AssetStore
  loader: ScratchAssetLoader
  kind: 'costume' | 'backdrop' | 'sound'
  onPickLocal: (entry: LibraryEntry) => void
  onPickScratch: (item: CatalogItem) => Promise<void>
  onUpload: (file: File) => void
  onClose: () => void
}

/** The dialog's own kind, which unlike the project's includes whole sprites. */
const kindsFor = (kind: Props['kind']): CatalogKind[] =>
  kind === 'costume' ? ['sprite', 'costume'] : [kind]

/**
 * Fetches an asset's bytes only once its card scrolls into view. Rendering all
 * 886 costume thumbnails eagerly would pull tens of megabytes for a dialog the
 * kid scrolls past in a second.
 */
function LazyThumb({ md5ext, res, loader }: { md5ext: string; res: number; loader: ScratchAssetLoader }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || src) return
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      io.disconnect()
      void loader.load(md5ext, res).then(a => setSrc(a.dataUrl)).catch(() => {})
    })
    io.observe(el)
    return () => io.disconnect()
  }, [md5ext, res, loader, src])

  return (
    <div ref={ref} className="library-thumb">
      {src ? <img src={src} alt="" width={48} height={48} style={{ objectFit: 'contain' }} /> : null}
    </div>
  )
}

export function LibraryDialog({
  manifest, catalog, store, loader, kind, onPickLocal, onPickScratch, onUpload, onClose,
}: Props) {
  const [tab, setTab] = useState<CatalogKind>(kindsFor(kind)[0])
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const local = manifest.entries.filter(e => e.kind === kind)
  const scratchItems = useMemo(
    () => (catalog ? searchItems(itemsOfKind(catalog, tab), query, tag) : []),
    [catalog, tab, query, tag],
  )

  const pick = async (item: CatalogItem) => {
    setBusy(item.name)
    setError(null)
    try {
      await onPickScratch(item)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="drawer library-dialog">
      <div className="toolbar">
        <h1>Choose a {kind}</h1>
        <button onClick={onClose}>Close</button>
      </div>

      <h3>Built in</h3>
      {local.map(entry => (
        <div className="library-entry" key={entry.id}>
          {kind === 'sound' ? (
            <button
              onClick={() => {
                const url = store.get(`library:${entry.id}`)?.dataUrl
                if (url) void new Audio(url).play().catch(() => {})
              }}
            >
              ▶ Play
            </button>
          ) : (
            <img src={store.get(`library:${entry.id}`)?.dataUrl} alt="" width={48} height={48} style={{ objectFit: 'contain' }} />
          )}
          <p>{entry.label}</p>
          <button onClick={() => onPickLocal(entry)}>Use this</button>
        </div>
      ))}

      <h3>From Scratch</h3>
      {catalog === null ? (
        <p className="library-offline">
          The Scratch library isn't available right now. The built-in assets above still work.
        </p>
      ) : (
        <>
          <div className="library-tabs">
            {kindsFor(kind).map(k => (
              <button key={k} className={k === tab ? 'active' : ''} onClick={() => setTab(k)}>
                {k === 'sprite' ? 'Sprites' : `${k[0].toUpperCase()}${k.slice(1)}s`}
              </button>
            ))}
          </div>
          <input
            className="library-search"
            type="search"
            placeholder="Search by name or tag…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="library-chips">
            {TAG_CHIPS.map(t => (
              <button key={t} className={t === tag ? 'active' : ''} onClick={() => setTag(t === tag ? null : t)}>
                {t}
              </button>
            ))}
          </div>
          {error ? (
            <p className="library-error" role="alert">
              {error} <button onClick={() => setError(null)}>Retry</button>
            </p>
          ) : null}
          <p className="library-count">{scratchItems.length} found</p>
          <div className="library-grid">
            {scratchItems.map(item => (
              <div className="library-entry" key={item.name}>
                {/*
                  Narrowed inline rather than through a shared `thumb` variable:
                  TypeScript can't carry a narrowing from a derived value back
                  to `item`, and only CatalogSound reaches the Play branch.
                */}
                {'costumes' in item ? (
                  <LazyThumb md5ext={item.costumes[0].md5ext} res={item.costumes[0].res} loader={loader} />
                ) : 'res' in item ? (
                  <LazyThumb md5ext={item.md5ext} res={item.res} loader={loader} />
                ) : (
                  <button
                    onClick={() => {
                      void loader
                        .load(item.md5ext, 1)
                        .then(a => new Audio(a.dataUrl).play())
                        .catch(() => {})
                    }}
                  >
                    ▶ Play
                  </button>
                )}
                <p>
                  {item.name}
                  {'seconds' in item ? <span className="library-secs"> {item.seconds}s</span> : null}
                </p>
                <button disabled={busy !== null} onClick={() => void pick(item)}>
                  {busy === item.name ? 'Adding…' : 'Use this'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Or upload your own</h3>
      <input
        type="file"
        accept={kind === 'sound' ? 'audio/*' : 'image/png,image/jpeg,image/svg+xml'}
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
        }}
      />
      <p className="library-credit">
        Sprites, backdrops and sounds from the{' '}
        <a href="https://scratch.mit.edu/" target="_blank" rel="noreferrer">Scratch</a> library,
        licensed{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
          CC BY-SA 4.0
        </a>. Built-in art is bundled with the app — see public/library/LICENSE.md.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Add the dialog styles**

Append to `src/ide/styles.css`:

```css
.library-tabs button.active,
.library-chips button.active { background: #1f2937; color: #fff; }
.library-tabs { display: flex; gap: 4px; margin: 8px 0; }
.library-search { width: 100%; padding: 6px 8px; margin: 4px 0; }
.library-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.library-chips button { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
.library-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.library-thumb { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; }
.library-count, .library-secs, .library-credit { font-size: 12px; color: #6b7280; }
.library-error { color: #b91c1c; font-size: 13px; }
.library-offline { font-size: 13px; color: #6b7280; }
```

- [ ] **Step 5: Verify the build and existing tests**

Run: `npm run build && npx vitest run`
Expected: build clean, all unit tests PASS.

- [ ] **Step 6: Look at it**

Run `make dev` and `make server-dev` in two shells, open the dev URL, click **+ Add sprite**, and confirm: the built-in ten appear, the Scratch grid shows a count near 339, typing `cat` narrows it, an `animals` chip narrows it, thumbnails fill in as you scroll, and picking a sprite adds it with all its costumes.

- [ ] **Step 7: Commit**

```bash
git add src/ide/components/LibraryDialog.tsx src/ide/components/App.tsx src/ide/styles.css
git commit -m "feat: searchable library dialog over the whole Scratch catalog"
```

---

### Task 8: End-to-end coverage, attribution, and doc cleanup

**Files:**
- Create: `e2e/scratch-library.spec.ts`
- Modify: `e2e/helpers.ts`, `public/library/LICENSE.md`, `docs/sprite_libraries.md`, `docs/TODO.md`
- Delete: `scripts/fetch-scratch-library.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: `pickFromScratch(page, name)` helper.

- [ ] **Step 1: Add the e2e helper**

Append to `e2e/helpers.ts`:

```ts
/** Click "Use this" on a Scratch catalog card, scoped to the catalog grid. */
export async function pickFromScratch(page: Page, name: string): Promise<void> {
  await page.locator('.library-dialog .library-search').fill(name)
  const card = page.locator('.library-dialog .library-grid .library-entry').filter({ hasText: name })
  await card.getByRole('button', { name: 'Use this' }).first().click()
  await expect(page.locator('.library-dialog')).toHaveCount(0)
}
```

- [ ] **Step 2: Write the failing e2e spec**

Create `e2e/scratch-library.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { pickFromScratch, run, stage, waitForLibrary } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForLibrary(page)
})

test('adds a Scratch sprite with its whole costume set, and it runs', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add sprite' }).click()
  await pickFromScratch(page, 'Abby')

  await expect(page.locator('.sprite-row')).toContainText('Abby')
  await expect(page.locator('.sprite-row img')).toHaveAttribute('src', /^data:/)

  await run(page)
  await expect(stage(page).locator('canvas')).toBeVisible()
})

test('searching narrows the catalog, and a tag chip narrows it further', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add sprite' }).click()

  const count = page.locator('.library-dialog .library-count')
  await expect(count).toContainText('339 found')

  await page.locator('.library-dialog .library-search').fill('cat')
  const afterSearch = await count.textContent()
  expect(Number(afterSearch?.match(/\d+/)?.[0])).toBeLessThan(339)

  await page.locator('.library-dialog .library-chips button', { hasText: 'animals' }).click()
  await expect(page.locator('.library-dialog .library-grid .library-entry').first()).toBeVisible()
})

test('shows a friendly error and keeps the built-ins when the CDN is down', async ({ page }) => {
  await page.route('https://assets.scratch.mit.edu/**', route => route.abort())

  await page.getByRole('button', { name: '+ Add sprite' }).click()
  await page.locator('.library-dialog .library-search').fill('Abby')
  await page
    .locator('.library-dialog .library-grid .library-entry')
    .filter({ hasText: 'Abby' })
    .getByRole('button', { name: 'Use this' })
    .first()
    .click()

  await expect(page.locator('.library-dialog .library-error')).toBeVisible()
  await expect(page.locator('.library-dialog')).toBeVisible()
  await expect(page.locator('.sprite-row')).toHaveCount(0)

  // The built-in ten still work with the CDN dead.
  await page.locator('.library-dialog .library-entry').filter({ hasText: 'Cat' })
    .getByRole('button', { name: 'Use this' }).first().click()
  await expect(page.locator('.sprite-row')).toContainText('Cat')
})
```

- [ ] **Step 3: Run the spec**

Run: `npx playwright test e2e/scratch-library.spec.ts`
Expected: PASS. If the `339 found` assertion fails, read the actual count and reconcile it against `node -e "console.log(require('./public/library/scratch-catalog.json').sprites.length)"` — the catalog is the source of truth, so fix the test to match it.

- [ ] **Step 4: Add the save/reload round-trip**

Append to `e2e/scratch-library.spec.ts`:

```ts
test.describe('saved games', () => {
  test.skip(!process.env.E2E_SERVER, 'Saving needs the real server (run with E2E_SERVER=1)')

  test('a Scratch costume survives a save and reload', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add sprite' }).click()
    await pickFromScratch(page, 'Abby')

    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Saved')).toBeVisible()

    await page.reload()
    await waitForLibrary(page)

    await expect(page.locator('.sprite-row')).toContainText('Abby')
    await expect(page.locator('.sprite-row img')).toHaveAttribute('src', /^data:/)
    await run(page)
    await expect(stage(page).locator('canvas')).toBeVisible()
  })
})
```

Run: `E2E_SERVER=1 npx playwright test e2e/scratch-library.spec.ts`
Expected: PASS. If the Save button's accessible name differs, check `src/ide/components/SaveBar.tsx` and match it.

- [ ] **Step 5: Correct the license file**

Replace `public/library/LICENSE.md` — it currently describes the deleted script:

```markdown
# Library assets

The starter assets in this directory (`cat-a`, `cat-b`, `ball`, `bat`, `star`,
`blue-sky`, `night`, `beep`, `boop`, `pop`) were authored for this project and
carry the project's own license. They are bundled with the app and work
offline.

`scratch-catalog.json` is generated by `scripts/build-scratch-catalog.ts` from
the Scratch project's library catalogs. It contains asset **names, tags, and
MD5 identifiers only** — no asset bytes.

The assets it points at are served from `assets.scratch.mit.edu` at runtime and
are licensed **CC BY-SA 4.0**
(https://creativecommons.org/licenses/by-sa/4.0/). The app credits the Scratch
project in the library dialog, as that license requires. See
`docs/sprite_libraries.md`.
```

- [ ] **Step 6: Delete the superseded script**

Run: `git rm scripts/fetch-scratch-library.mjs`

Then check nothing references it:

Run: `grep -rn "fetch-scratch-library" --exclude-dir=node_modules --exclude-dir=.git .`
Expected: hits only in `docs/` (fixed in the next step) — no hits in `Makefile`, `package.json`, or `src/`.

- [ ] **Step 7: Update the docs**

In `docs/sprite_libraries.md`, replace the "Suggested bootstrap approach" section with what was actually built: a checked-in catalog generated by `scripts/build-scratch-catalog.ts` from a pinned SHA, runtime CDN fetches keyed `scratch:<md5ext>`, and dimensions measured in the browser. Keep the "Where the assets live" and license sections — both are still accurate. Update the `scripts/fetch-scratch-library.mjs` mention to the new script name, and link the design spec.

In `docs/TODO.md`, append under the engine follow-ups:

```markdown
- [ ] The Scratch library depends on `assets.scratch.mit.edu` at runtime: a saved game using Scratch assets won't open if MIT blocks or changes that endpoint, and every player's IP is exposed to it. Mirroring the ~1,331 referenced assets onto our own origin would remove both, at the cost of hosting them.
- [ ] If a `connect-src` CSP is ever added to the app, it must include `https://assets.scratch.mit.edu` or the whole Scratch library goes dark.
- [ ] Scratch's `rotationCenterX/Y` is ignored — our engine is centre-anchored, so off-centre Scratch costumes sit slightly differently than they do in Scratch.
```

- [ ] **Step 8: Run everything**

Run: `npm run build && npx vitest run && npx playwright test`
Expected: build clean, all unit tests PASS, all e2e PASS.

Run: `E2E_SERVER=1 npx playwright test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "test: cover the Scratch library end to end, and credit it properly"
```

---

## Done when

- `public/library/scratch-catalog.json` is checked in with 339 sprites, 886 costumes, 85 backdrops, and 353 sounds.
- A kid can search "cat", pick a Scratch sprite, and Run it — with all its costumes, so `nextCostume()` animates.
- That game saves, reloads on another device, and still runs.
- With the CDN blocked, the app still starts, the built-in ten still work, and the failure is a message rather than a crash.
- The library dialog credits Scratch and links CC BY-SA 4.0.
- `npm run build`, `npx vitest run`, `npx playwright test`, and `E2E_SERVER=1 npx playwright test` all pass.
