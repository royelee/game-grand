import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { completionsFor, spriteMemberCompletions, stageMemberCompletions } from './completions'

// Bundle Monaco from npm instead of the default CDN loader: the app must work
// offline and under a strict CSP.
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    return label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker()
  },
}
loader.config({ monaco })

let registered = false

export function registerGameCompletions(scopeOf: () => 'main' | 'sprite'): void {
  if (registered) return
  registered = true
  monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const line = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      const dotted = /(\w+)\s*\.\w*$/.exec(line)
      const items =
        dotted?.[1] === 'sprite' ? spriteMemberCompletions()
        : dotted?.[1] === 'stage' ? stageMemberCompletions()
        : dotted ? []
        : completionsFor(scopeOf())
      return {
        suggestions: items.map(item => ({
          label: item.label,
          kind:
            item.kind === 'method'
              ? monaco.languages.CompletionItemKind.Method
              : monaco.languages.CompletionItemKind.Property,
          insertText: item.insertText,
          insertTextRules: item.isSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          detail: item.detail,
          documentation: item.documentation,
          range,
        })),
      }
    },
  })
}
