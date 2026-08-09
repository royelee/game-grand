import { useMemo, useState } from 'react'
import { exampleSnippet, groupByCategory, searchApi } from '../reference'

interface Props {
  onInsert: (example: string) => void
}

export function ApiDrawer({ onInsert }: Props) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupByCategory(searchApi(query)), [query])

  return (
    <div className="drawer">
      <input
        value={query}
        placeholder="Search the API…"
        onChange={e => setQuery(e.target.value)}
      />
      {groups.length === 0 && <p className="empty-note">Nothing matches "{query}".</p>}
      {groups.map(group => (
        <section key={group.category}>
          <h3>{group.category}</h3>
          {group.defs.map(def => (
            <div className="api-entry" key={`${def.category}-${def.name}`}>
              <code>{def.signature}</code>
              <p>{def.description}</p>
              <button onClick={() => onInsert(exampleSnippet(def))}>Insert example</button>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
