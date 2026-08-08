import { API_DEFS, type ApiDef } from '../shared/apiDefs'

export interface CompletionItem {
  label: string
  insertText: string
  detail: string
  documentation: string
  kind: 'method' | 'property'
}

const kindOf = (def: ApiDef): 'method' | 'property' =>
  def.signature.includes('(') ? 'method' : 'property'

/** `sprite.move(10)` → `move(10)`; `mouse.x, mouse.y…` → `mouse` */
function insertTextFor(def: ApiDef, stripPrefix: boolean): string {
  const example = def.example.split('\n')[0].replace(/^await /, '')
  if (stripPrefix && example.startsWith('sprite.')) return example.slice('sprite.'.length)
  if (!stripPrefix && def.name.includes('.')) return def.name.split('.')[0]
  return example
}

function toItem(def: ApiDef, stripPrefix: boolean): CompletionItem {
  return {
    label: stripPrefix ? def.name : def.name.split('.')[0],
    insertText: insertTextFor(def, stripPrefix),
    detail: def.signature,
    documentation: def.description,
    kind: kindOf(def),
  }
}

/** Top-level identifiers available in a tab. */
export function completionsFor(scope: 'main' | 'sprite'): CompletionItem[] {
  const items = new Map<string, CompletionItem>()
  for (const def of API_DEFS) {
    if (def.scope !== 'global') continue
    const item = toItem(def, false)
    if (!items.has(item.label)) items.set(item.label, item)
  }
  if (scope === 'sprite') {
    items.set('sprite', {
      label: 'sprite',
      insertText: 'sprite',
      detail: 'sprite',
      documentation: 'This sprite. Try sprite.move(10) or sprite.say("Hi").',
      kind: 'property',
    })
  }
  return [...items.values()]
}

/** Members offered after typing `sprite.` */
export function spriteMemberCompletions(): CompletionItem[] {
  return API_DEFS.filter(d => d.scope === 'sprite').map(d => toItem(d, true))
}
