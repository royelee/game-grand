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

export function groupByCategory(defs: ApiDef[]): { category: ApiCategory; defs: ApiDef[] }[] {
  return CATEGORY_ORDER.map(category => ({
    category,
    defs: defs.filter(d => d.category === category),
  })).filter(g => g.defs.length > 0)
}
