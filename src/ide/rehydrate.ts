import { downscale, measureImage } from './upload'
import type { AssetStore } from './library'
import type { Project } from '../shared/project'

export interface RehydrateIssue {
  message: string
}

export interface RehydrateResult {
  additions: AssetStore
  issues: RehydrateIssue[]
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
 * One bad asset (a corrupt data URL, a decode failure) is reported as an
 * issue and skipped rather than aborting the rest of the load — a kid's
 * whole game shouldn't fail to open because a single costume is broken.
 */
export async function rehydrateAssetStore(
  project: Project,
  measure: typeof measureImage = measureImage,
): Promise<RehydrateResult> {
  const soundSources = new Set(project.sounds.map(ref => ref.source))

  const sources = new Set<string>()
  for (const sprite of project.sprites) {
    for (const costume of sprite.costumes) {
      if (costume.source.startsWith('data:')) sources.add(costume.source)
    }
  }
  for (const backdrop of project.stage.backdrops) {
    if (backdrop.source.startsWith('data:')) sources.add(backdrop.source)
  }
  for (const sound of project.sounds) {
    if (sound.source.startsWith('data:')) sources.add(sound.source)
  }

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

  return { additions, issues }
}
