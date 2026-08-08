import type { AssetStore, LibraryEntry, LibraryManifest } from '../library'

interface Props {
  manifest: LibraryManifest
  store: AssetStore
  kind: 'costume' | 'backdrop'
  onPick: (entry: LibraryEntry) => void
  onUpload: (file: File) => void
  onClose: () => void
}

export function LibraryDialog({ manifest, store, kind, onPick, onUpload, onClose }: Props) {
  const entries = manifest.entries.filter(e => e.kind === kind)
  return (
    <div className="drawer">
      <div className="toolbar">
        <h1>Choose a {kind}</h1>
        <button onClick={onClose}>Close</button>
      </div>
      {entries.map(entry => (
        <div className="api-entry" key={entry.id}>
          <img src={store.get(`library:${entry.id}`)?.dataUrl} alt="" width={48} height={48} style={{ objectFit: 'contain' }} />
          <p>{entry.label}</p>
          <button onClick={() => onPick(entry)}>Use this</button>
        </div>
      ))}
      <h3>Or upload your own</h3>
      <input
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
        }}
      />
      <p style={{ fontSize: 12, color: '#6b7280' }}>
        Built-in art is bundled with the app. See public/library/LICENSE.md for credits.
      </p>
    </div>
  )
}
