import { downscale, measureImage } from './upload'
import { ScratchAssetLoader, scratchMd5Ext } from './scratchAssets'
import type { AssetStore, LoadedAsset } from './library'
import type { Project } from '../shared/project'

export interface RehydrateIssue {
  message: string
}

export interface RehydrateResult {
  additions: AssetStore
  issues: RehydrateIssue[]
}

/** Just the part of ScratchAssetLoader this needs — keeps the test's stub small. */
export interface AssetLoading {
  load(md5ext: string, res: number): Promise<LoadedAsset>
}

/**
 * Rebuilds the in-memory AssetStore entries a loaded project needs but
 * doesn't carry with it: an uploaded costume/backdrop/sound stores its bytes
 * as `source: <data URL>` in the project document, but its pixel dimensions
 * only ever lived in the AssetStore, seeded once at upload time in *that*
 * browser session. Opening the project's link fresh — a reload, a different
 * device, a different browser — starts with an empty store, so
 * `makeResolver` throws `Asset "..." has not been loaded.` the instant Run
 * tries to use one, and its thumbnail never renders either.
 *
 * Scans every sprite costume, stage backdrop, and sound for a `data:` source
 * (`library:` refs are covered by `preloadLibrary` instead, so they're
 * skipped here) and re-derives what the store needs: images get measured and
 * downscaled exactly as `uploadAsset` does on the way in; sounds get
 * `{ width: 0, height: 0 }`, mirroring how `uploadAsset` records them.
 * Sound-ness is decided by membership in `project.sounds` — never by
 * sniffing the data URL's MIME type — so this can't drift from how uploads
 * are actually recorded.
 *
 * `scratch:` refs are covered by neither preloadLibrary nor the `data:` pass:
 * they name bytes the project doesn't carry and the app doesn't bundle, so
 * they are downloaded from the Scratch CDN here.
 *
 * One bad asset (a corrupt data URL, a decode failure, an unreachable CDN) is
 * reported as an issue and skipped rather than aborting the rest of the load —
 * a kid's whole game shouldn't fail to open because a single costume is broken
 * or because MIT is having a bad day.
 */
export async function rehydrateAssetStore(
  project: Project,
  measure: typeof measureImage = measureImage,
  loader: AssetLoading = new ScratchAssetLoader(),
): Promise<RehydrateResult> {
  const soundSources = new Set(project.sounds.map(ref => ref.source))

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

  const additions: AssetStore = new Map()
  const issues: RehydrateIssue[] = []

  await Promise.all(
    [...sources].map(async source => {
      try {
        if (soundSources.has(source)) {
          additions.set(source, { dataUrl: source, width: 0, height: 0 })
        } else {
          const natural = await measure(source)
          const size = downscale(natural.width, natural.height)
          additions.set(source, { dataUrl: source, ...size })
        }
      } catch (err) {
        issues.push({
          message: `Couldn't load an uploaded picture or sound: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }),
  )

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

  return { additions, issues }
}
