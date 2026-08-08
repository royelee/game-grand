import Editor from '@monaco-editor/react'
import { useEffect, useRef } from 'react'
import { registerGameCompletions } from '../monacoSetup'

interface Props {
  tab: string
  value: string
  onChange: (value: string) => void
}

export function CodeEditor({ tab, value, onChange }: Props) {
  // The completion provider is registered once for the app's lifetime, but it
  // must see the tab that is current when the user types — so it reads through
  // a ref that an effect keeps up to date (never mutate during render).
  const tabRef = useRef(tab)
  useEffect(() => {
    tabRef.current = tab
  }, [tab])
  useEffect(() => {
    registerGameCompletions(() => (tabRef.current === 'main' ? 'main' : 'sprite'))
  }, [])

  return (
    <div className="editor">
      <Editor
        height="100%"
        defaultLanguage="javascript"
        path={`file:///${tab}.js`}
        value={value}
        onChange={v => onChange(v ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          tabSize: 2,
          automaticLayout: true,
        }}
      />
    </div>
  )
}
