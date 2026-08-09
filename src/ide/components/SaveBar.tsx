import { useState } from 'react'
import { projectUrl } from '../api'
import type { IdeState } from '../store'

interface Props {
  state: IdeState
  onRename: (name: string) => void
  onSave: () => void
  onOpenLoad: () => void
}

export function SaveBar({ state, onRename, onSave, onOpenLoad }: Props) {
  const [copied, setCopied] = useState(false)
  const link = state.projectId ? `${window.location.origin}${projectUrl(state.projectId)}` : null

  const status =
    state.save.status === 'saving' ? 'Saving…'
    : state.save.status === 'saved' ? 'Saved'
    : state.save.status === 'error' ? state.save.message
    : ''

  return (
    <div className="savebar">
      <input
        aria-label="Game name"
        value={state.project.name}
        onChange={e => onRename(e.target.value)}
      />
      <button className="primary" onClick={onSave} disabled={state.save.status === 'saving'}>
        Save
      </button>
      <button onClick={onOpenLoad}>Load</button>
      <span className={state.save.status === 'error' ? 'save-error' : 'save-status'}>{status}</span>
      {link && (
        <>
          <input aria-label="Game link" className="link" readOnly value={link} />
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(link)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <span className="link-warning">This link is the only way back to this game — save it somewhere safe!</span>
        </>
      )}
    </div>
  )
}
