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
