import { API_DEFS, type ApiCategory, type ApiDef } from '../shared/apiDefs'

export const CATEGORY_ORDER: ApiCategory[] = [
  'Motion', 'Looks', 'Sound', 'Events', 'Sensing', 'Control', 'Stage', 'Variables',
]

export function searchApi(query: string): ApiDef[] {
  const q = query.trim().toLowerCase()
  if (q === '') return API_DEFS
  return API_DEFS.filter(
    d =>
      d.name.toLowerCase().includes(q) ||
      d.signature.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q),
  )
}

/**
 * The runnable form of a def's example.
 *
 * Scripts are compiled as ordinary functions, so a top-level `await` is a
 * syntax error. Examples that start with `await` are teaching fragments meant
 * to live inside a handler — wrap them in one so "Insert example" always hands
 * a kid code that runs, and shows them where awaiting belongs.
 */
export function exampleSnippet(def: ApiDef): string {
  if (!/^await\b/.test(def.example.trim())) return def.example
  const body = def.example
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')
  return `onStart(async () => {\n${body}\n})`
}

export function groupByCategory(defs: ApiDef[]): { category: ApiCategory; defs: ApiDef[] }[] {
  return CATEGORY_ORDER.map(category => ({
    category,
    defs: defs.filter(d => d.category === category),
  })).filter(g => g.defs.length > 0)
}
