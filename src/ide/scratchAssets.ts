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
