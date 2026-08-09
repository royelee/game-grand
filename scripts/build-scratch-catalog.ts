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
