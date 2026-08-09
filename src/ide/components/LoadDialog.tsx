import { useState } from 'react'
import type { RecentGame } from '../recentGames'

interface Props {
  recent: RecentGame[]
  onOpen: (id: string) => void
  onForget: (id: string) => void
  onClose: () => void
}

/** Pulls the id out of a full link or accepts a bare id. */
export function idFromLink(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const match = trimmed.match(/\/p\/([A-Za-z0-9_-]{22})/)
  if (match) return match[1]
  return /^[A-Za-z0-9_-]{22}$/.test(trimmed) ? trimmed : null
}

export function LoadDialog({ recent, onOpen, onForget, onClose }: Props) {
  const [link, setLink] = useState('')
  const id = idFromLink(link)

  return (
    <div className="drawer load-dialog">
      <div className="toolbar">
        <h1>Open a game</h1>
        <button onClick={onClose}>Close</button>
      </div>

      <h3>Paste a game link</h3>
      <input aria-label="Game link to open" value={link} onChange={e => setLink(e.target.value)} />
      <button disabled={!id} onClick={() => id && onOpen(id)}>Open</button>
      {link !== '' && !id && <p className="empty-note">That doesn’t look like a game link.</p>}

      <h3>Games on this device</h3>
      {recent.length === 0 && <p className="empty-note">Nothing saved here yet.</p>}
      {recent.map(game => (
        <div className="library-entry" key={game.id}>
          <p>{game.name}</p>
          <button onClick={() => onOpen(game.id)}>Open</button>
          <button onClick={() => onForget(game.id)}>Forget</button>
        </div>
      ))}
    </div>
  )
}
