import { API_DEFS, type ApiDef } from '../shared/apiDefs'

export interface CompletionItem {
  label: string
  insertText: string
  isSnippet: boolean
  detail: string
  documentation: string
  kind: 'method' | 'property'
}

const isMethod = (def: ApiDef): boolean => def.signature.includes('(')

/** Parameter names from a signature: `sprite.say(text, seconds?)` → ['text','seconds?'] */
export function paramsOf(signature: string): string[] {
  const open = signature.indexOf('(')
  if (open === -1) return []
  const inner = signature.slice(open + 1, signature.lastIndexOf(')')).trim()
  return inner === '' ? [] : inner.split(',').map(p => p.trim())
}

/**
 * What accepting a suggestion types for you. Always balanced, runnable code —
 * a kid must never have to repair what the editor inserted. Handlers get a
 * complete arrow function with the cursor in the body; other calls get parens
 * with the cursor inside; values insert their bare name.
 *
 * Derived from `signature`, never from `example`: examples are teaching
 * snippets (multi-line, sometimes wrapped in an `if` or a different call), so
 * slicing them produces fragments like `onStart(() => {`.
 */
function insertFor(identifier: string, def: ApiDef): { insertText: string; isSnippet: boolean } {
  if (!isMethod(def)) return { insertText: identifier, isSnippet: false }
  const params = paramsOf(def.signature)
  if (params.length === 0) return { insertText: `${identifier}()`, isSnippet: false }
  if (params[params.length - 1] === 'fn') {
    const lead = params.slice(0, -1).map((_, i) => `"$${i + 1}", `).join('')
    return { insertText: `${identifier}(${lead}() => {\n  $0\n})`, isSnippet: true }
  }
  return { insertText: `${identifier}($0)`, isSnippet: true }
}

function toItem(identifier: string, def: ApiDef): CompletionItem {
  return {
    label: identifier,
    ...insertFor(identifier, def),
    detail: def.signature,
    documentation: def.description,
    kind: isMethod(def) ? 'method' : 'property',
  }
}

/** Top-level identifiers available in a tab. */
export function completionsFor(scope: 'main' | 'sprite'): CompletionItem[] {
  const items = new Map<string, CompletionItem>()
  for (const def of API_DEFS) {
    if (def.scope !== 'global') continue
    if (def.name.includes('.')) {
      // A namespace like `stage.switchBackdrop`: offer the object itself.
      const root = def.name.split('.')[0]
      if (!items.has(root)) {
        items.set(root, {
          label: root,
          insertText: root,
          isSnippet: false,
          detail: root,
          documentation: `The ${root} object. Type ${root}. to see what it can do.`,
          kind: 'property',
        })
      }
      continue
    }
    if (!items.has(def.name)) items.set(def.name, toItem(def.name, def))
  }
  if (scope === 'sprite') {
    items.set('sprite', {
      label: 'sprite',
      insertText: 'sprite',
      isSnippet: false,
      detail: 'sprite',
      documentation: 'This sprite. Type sprite. to see what it can do.',
      kind: 'property',
    })
  }
  return [...items.values()]
}

/** Members offered after typing `sprite.` */
export function spriteMemberCompletions(): CompletionItem[] {
  return API_DEFS.filter(d => d.scope === 'sprite').map(d => toItem(d.name, d))
}

/** Members offered after typing `stage.` */
export function stageMemberCompletions(): CompletionItem[] {
  return API_DEFS.filter(d => d.name.startsWith('stage.')).map(d =>
    toItem(d.name.slice('stage.'.length), d),
  )
}
