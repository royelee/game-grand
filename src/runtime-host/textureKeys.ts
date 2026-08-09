import type { RunPayload } from '../shared/protocol'

export interface TextureIndex {
  /** Every distinct costume `dataUrl` in the payload, mapped to a stable, unique Phaser texture key. */
  keyForDataUrl: Map<string, string>
  /** sprite name -> costume name -> texture key, for resolving a snapshot's costume name back to art. */
  bySprite: Map<string, Map<string, string>>
}

/**
 * A costume name is only unique within a sprite, not across the whole
 * project — an uploaded costume named "cat-a" can collide with the library's
 * own "cat-a". Preloading and rendering by costume name means whichever
 * loads first wins and the other sprite shows the wrong art. This builds a
 * key per distinct dataUrl instead, so identity is by content, not name.
 *
 * Pulled out of StageScene so the mapping logic can be unit-tested without
 * Phaser/canvas; StageScene stays the (untested) glue that drives Phaser
 * with it.
 */
export function buildTextureIndex(payload: RunPayload): TextureIndex {
  const keyForDataUrl = new Map<string, string>()
  const bySprite = new Map<string, Map<string, string>>()
  let n = 0

  const keyFor = (dataUrl: string): string => {
    const existing = keyForDataUrl.get(dataUrl)
    if (existing) return existing
    const key = `tex${n++}`
    keyForDataUrl.set(dataUrl, key)
    return key
  }

  for (const sprite of payload.sprites) {
    const costumes = new Map<string, string>()
    for (const costume of sprite.costumes) costumes.set(costume.name, keyFor(costume.dataUrl))
    bySprite.set(sprite.name, costumes)
  }

  return { keyForDataUrl, bySprite }
}
