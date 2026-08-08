import type { ConsoleLine } from '../store'

export function ConsolePane({ lines }: { lines: ConsoleLine[] }) {
  return (
    <div className="console">
      {lines.length === 0 && <div className="empty">Console output appears here.</div>}
      {lines.map((line, i) => (
        <div key={i} className={line.kind === 'issue' ? 'issue' : undefined}>
          {line.text}
        </div>
      ))}
    </div>
  )
}
