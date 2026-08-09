import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssetStore, LibraryEntry, LibraryManifest } from '../library'
import {
  TAG_CHIPS, itemsOfKind, searchItems, type CatalogItem, type CatalogKind,
} from '../catalogSearch'
import type { ScratchAssetLoader } from '../scratchAssets'
import type { ScratchCatalog } from '../../shared/scratchCatalog'

interface Props {
  manifest: LibraryManifest
  catalog: ScratchCatalog | null
  store: AssetStore
  loader: ScratchAssetLoader
  kind: 'costume' | 'backdrop' | 'sound'
  onPickLocal: (entry: LibraryEntry) => void
  onPickScratch: (item: CatalogItem) => Promise<void>
  onUpload: (file: File) => void
  onClose: () => void
}

/** The dialog's own kind, which unlike the project's includes whole sprites. */
const kindsFor = (kind: Props['kind']): CatalogKind[] =>
  kind === 'costume' ? ['sprite', 'costume'] : [kind]

/**
 * Fetches an asset's bytes only once its card scrolls into view. Rendering all
 * 886 costume thumbnails eagerly would pull tens of megabytes for a dialog the
 * kid scrolls past in a second.
 */
function LazyThumb({ md5ext, res, loader }: { md5ext: string; res: number; loader: ScratchAssetLoader }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || src) return
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      io.disconnect()
      void loader.load(md5ext, res).then(a => setSrc(a.dataUrl)).catch(() => {})
    })
    io.observe(el)
    return () => io.disconnect()
  }, [md5ext, res, loader, src])

  return (
    <div ref={ref} className="library-thumb">
      {src ? <img src={src} alt="" width={48} height={48} style={{ objectFit: 'contain' }} /> : null}
    </div>
  )
}

export function LibraryDialog({
  manifest, catalog, store, loader, kind, onPickLocal, onPickScratch, onUpload, onClose,
}: Props) {
  const [tab, setTab] = useState<CatalogKind>(kindsFor(kind)[0])
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const local = manifest.entries.filter(e => e.kind === kind)
  const scratchItems = useMemo(
    () => (catalog ? searchItems(itemsOfKind(catalog, tab), query, tag) : []),
    [catalog, tab, query, tag],
  )

  const pick = async (item: CatalogItem) => {
    setBusy(item.name)
    setError(null)
    try {
      await onPickScratch(item)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="drawer library-dialog">
      <div className="toolbar">
        <h1>Choose a {kind}</h1>
        <button onClick={onClose}>Close</button>
      </div>

      {catalog === null ? (
        <p className="library-offline">
          The Scratch library isn't available right now. The built-in assets above still work.
        </p>
      ) : (
        <>
          {/*
            Controls sit directly under the toolbar, and the Scratch grid comes
            before the built-in ten. With 339 sprites against 5 bundled ones,
            putting "Built in" first buried both the search box and the entire
            library below the fold of a 320px drawer.
          */}
          <div className="library-controls">
            <div className="library-tabs">
              {kindsFor(kind).map(k => (
                <button key={k} className={k === tab ? 'active' : ''} onClick={() => setTab(k)}>
                  {k === 'sprite' ? 'Sprites' : `${k[0].toUpperCase()}${k.slice(1)}s`}
                </button>
              ))}
            </div>
            <input
              className="library-search"
              type="search"
              placeholder="Search by name or tag…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            <div className="library-chips">
              {TAG_CHIPS.map(t => (
                <button key={t} className={t === tag ? 'active' : ''} onClick={() => setTag(t === tag ? null : t)}>
                  {t}
                </button>
              ))}
            </div>
            {error ? (
              <p className="library-error" role="alert">
                {error} <button onClick={() => setError(null)}>Retry</button>
              </p>
            ) : null}
            <p className="library-count">{scratchItems.length} found</p>
          </div>
          <div className="library-grid">
            {scratchItems.map(item => (
              <div className="library-entry" key={item.name}>
                {/*
                  Narrowed inline rather than through a shared `thumb` variable:
                  TypeScript can't carry a narrowing from a derived value back
                  to `item`, and only CatalogSound reaches the Play branch.
                */}
                {'costumes' in item ? (
                  <LazyThumb md5ext={item.costumes[0].md5ext} res={item.costumes[0].res} loader={loader} />
                ) : 'res' in item ? (
                  <LazyThumb md5ext={item.md5ext} res={item.res} loader={loader} />
                ) : (
                  <button
                    onClick={() => {
                      void loader
                        .load(item.md5ext, 1)
                        .then(a => new Audio(a.dataUrl).play())
                        .catch(() => {})
                    }}
                  >
                    ▶ Play
                  </button>
                )}
                <p>
                  {item.name}
                  {'seconds' in item ? <span className="library-secs"> {item.seconds}s</span> : null}
                </p>
                <button disabled={busy !== null} onClick={() => void pick(item)}>
                  {busy === item.name ? 'Adding…' : 'Use this'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/*
        Its own container so a test (or a stylesheet) can address the bundled
        ten without also matching a Scratch card of the same name — there is a
        Scratch "Cat" as well as ours.
      */}
      <div className="library-builtin">
        <h3>Built in</h3>
        {local.map(entry => (
          <div className="library-entry" key={entry.id}>
            {kind === 'sound' ? (
              <button
                onClick={() => {
                  const url = store.get(`library:${entry.id}`)?.dataUrl
                  if (url) void new Audio(url).play().catch(() => {})
                }}
              >
                ▶ Play
              </button>
            ) : (
              <img src={store.get(`library:${entry.id}`)?.dataUrl} alt="" width={48} height={48} style={{ objectFit: 'contain' }} />
            )}
            <p>{entry.label}</p>
            <button onClick={() => onPickLocal(entry)}>Use this</button>
          </div>
        ))}
      </div>

      <h3>Or upload your own</h3>
      <input
        type="file"
        accept={kind === 'sound' ? 'audio/*' : 'image/png,image/jpeg,image/svg+xml'}
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
        }}
      />
      <p className="library-credit">
        Sprites, backdrops and sounds from the{' '}
        <a href="https://scratch.mit.edu/" target="_blank" rel="noreferrer">Scratch</a> library,
        licensed{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
          CC BY-SA 4.0
        </a>. Built-in art is bundled with the app — see public/library/LICENSE.md.
      </p>
    </div>
  )
}
