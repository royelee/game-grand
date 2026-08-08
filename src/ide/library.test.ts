import { describe, it, expect } from 'vitest'
import {
  libraryRefId, makeResolver, refsForEntry, loadManifest, preloadLibrary,
  type AssetStore, type LibraryManifest,
} from './library'

const manifest: LibraryManifest = {
  entries: [
    { id: 'cat-a', kind: 'costume', label: 'Cat', file: 'cat-a.svg', width: 60, height: 60 },
    { id: 'blue-sky', kind: 'backdrop', label: 'Blue sky', file: 'blue-sky.svg', width: 480, height: 360 },
  ],
}
const store: AssetStore = new Map([
  ['library:cat-a', { dataUrl: 'data:image/svg+xml;base64,AAA', width: 60, height: 60 }],
  ['library:blue-sky', { dataUrl: 'data:image/svg+xml;base64,BBB', width: 480, height: 360 }],
])

describe('library refs', () => {
  it('extracts library ids and ignores other sources', () => {
    expect(libraryRefId('library:cat-a')).toBe('cat-a')
    expect(libraryRefId('data:image/png;base64,xyz')).toBeNull()
  })

  it('builds an AssetRef from an entry', () => {
    expect(refsForEntry(manifest.entries[0])).toEqual({ name: 'cat-a', source: 'library:cat-a' })
  })
})

describe('resolver', () => {
  it('resolves library refs to dimensions and data urls', () => {
    const resolve = makeResolver(store)
    expect(resolve({ name: 'cat-a', source: 'library:cat-a' })).toEqual({
      name: 'cat-a', width: 60, height: 60, dataUrl: 'data:image/svg+xml;base64,AAA',
    })
  })

  it('resolves uploaded refs from the same store, keyed by their data url', () => {
    const withUpload: AssetStore = new Map(store)
    withUpload.set('data:image/png;base64,zzz', {
      dataUrl: 'data:image/png;base64,zzz', width: 32, height: 48,
    })
    expect(makeResolver(withUpload)({ name: 'me', source: 'data:image/png;base64,zzz' })).toEqual({
      name: 'me', width: 32, height: 48, dataUrl: 'data:image/png;base64,zzz',
    })
  })

  it('keeps the ref name, not the library id, so renamed costumes still work', () => {
    const resolve = makeResolver(store)
    expect(resolve({ name: 'my-cat', source: 'library:cat-a' }).name).toBe('my-cat')
  })

  it('throws a clear error for an asset that was never loaded', () => {
    const resolve = makeResolver(store)
    expect(() => resolve({ name: 'x', source: 'library:nope' })).toThrow(/library:nope/)
  })
})

describe('loading', () => {
  it('loads the manifest as json', async () => {
    const fetchFn = async () => ({ ok: true, json: async () => manifest }) as unknown as Response
    expect(await loadManifest(fetchFn)).toEqual(manifest)
  })

  it('rejects a failed manifest fetch', async () => {
    const fetchFn = async () => ({ ok: false, status: 404 }) as unknown as Response
    await expect(loadManifest(fetchFn)).rejects.toThrow(/404/)
  })

  it('preloads every entry into a store keyed by ref source, carrying dimensions', async () => {
    const fetchFn = async (url: string) => ({
      ok: true,
      blob: async () => url,
    }) as unknown as Response
    const toDataUrl = async (blob: unknown) => `data:fake,${String(blob)}`
    const loaded = await preloadLibrary(manifest, fetchFn, toDataUrl)
    expect(loaded.get('library:cat-a')).toEqual({
      dataUrl: 'data:fake,/library/cat-a.svg', width: 60, height: 60,
    })
    expect(loaded.size).toBe(2)
  })
})
