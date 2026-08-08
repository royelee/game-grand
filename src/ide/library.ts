import type { LoadedCostume } from '../shared/protocol'
import type { AssetRef } from '../shared/project'

export interface LibraryEntry {
  id: string
  kind: 'costume' | 'backdrop' | 'sound'
  label: string
  file: string
  width: number
  height: number
}

export interface LibraryManifest {
  entries: LibraryEntry[]
}

/** A decoded asset: the bytes plus the size we measured. */
export interface LoadedAsset {
  dataUrl: string
  width: number
  height: number
}

/**
 * Every asset the app has loaded, keyed by `AssetRef.source`
 * (`library:<id>` or the upload's own data URL).
 *
 * Dimensions live here rather than on the AssetRef, following Scratch's own
 * catalogs: a reference identifies an asset, the loaded asset describes it.
 * See docs/sprite_libraries.md.
 */
export type AssetStore = Map<string, LoadedAsset>

export const LIBRARY_BASE = '/library'

export function libraryRefId(source: string): string | null {
  return source.startsWith('library:') ? source.slice('library:'.length) : null
}

export function refsForEntry(entry: LibraryEntry): AssetRef {
  return { name: entry.id, source: `library:${entry.id}` }
}

/**
 * Turns AssetRefs into fully-loaded costumes by looking each ref's source up
 * in the store. Library assets land there during preload; uploads land there
 * when the user adds them. Anything not in the store is a bug in the caller,
 * not a user error — every asset is loaded before a run starts.
 */
export function makeResolver(store: AssetStore): (ref: AssetRef) => LoadedCostume {
  return (ref: AssetRef): LoadedCostume => {
    const asset = store.get(ref.source)
    if (!asset) {
      throw new Error(`Asset "${ref.source}" has not been loaded.`)
    }
    return {
      name: ref.name,
      width: asset.width,
      height: asset.height,
      dataUrl: asset.dataUrl,
    }
  }
}

export async function loadManifest(
  fetchFn: (url: string) => Promise<Response> = fetch,
): Promise<LibraryManifest> {
  const res = await fetchFn(`${LIBRARY_BASE}/library.json`)
  if (!res.ok) throw new Error(`Could not load the asset library (HTTP ${res.status}).`)
  return (await res.json()) as LibraryManifest
}

export async function fetchAsDataUrl(
  url: string,
  fetchFn: (url: string) => Promise<Response> = fetch,
  toDataUrl: (blob: Blob) => Promise<string> = blobToDataUrl,
): Promise<string> {
  const res = await fetchFn(url)
  if (!res.ok) throw new Error(`Could not load asset ${url} (HTTP ${res.status}).`)
  return toDataUrl(await res.blob())
}

export async function preloadLibrary(
  manifest: LibraryManifest,
  fetchFn: (url: string) => Promise<Response> = fetch,
  toDataUrl: (blob: Blob) => Promise<string> = blobToDataUrl,
): Promise<AssetStore> {
  const pairs = await Promise.all(
    manifest.entries.map(async e => {
      const dataUrl = await fetchAsDataUrl(`${LIBRARY_BASE}/${e.file}`, fetchFn, toDataUrl)
      return [`library:${e.id}`, { dataUrl, width: e.width, height: e.height }] as const
    }),
  )
  return new Map(pairs)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
