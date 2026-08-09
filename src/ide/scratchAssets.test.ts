import { describe, it, expect, vi } from 'vitest'
import {
  ScratchAssetLoader, assetUrl, fetchScratchAsset, isSoundAsset, scratchMd5Ext, scratchSource,
} from './scratchAssets'

const okFetch = async () => ({ ok: true, blob: async () => 'BLOB' }) as unknown as Response
const toDataUrl = async (blob: unknown) => `data:fake,${String(blob)}`
const measure = async () => ({ width: 120, height: 80 })

describe('scratch refs', () => {
  it('round-trips a source and an md5ext', () => {
    expect(scratchSource('a1.svg')).toBe('scratch:a1.svg')
    expect(scratchMd5Ext('scratch:a1.svg')).toBe('a1.svg')
  })

  it('ignores refs belonging to other schemes', () => {
    expect(scratchMd5Ext('library:cat-a')).toBeNull()
    expect(scratchMd5Ext('data:image/png;base64,xyz')).toBeNull()
  })

  it('builds the CDN url with its trailing slash', () => {
    expect(assetUrl('a1.svg')).toBe('https://assets.scratch.mit.edu/internalapi/asset/a1.svg/get/')
  })

  it('decides sound-ness from the extension, never from dataFormat', () => {
    expect(isSoundAsset('c1.wav')).toBe(true)
    expect(isSoundAsset('a1.svg')).toBe(false)
    expect(isSoundAsset('b1.png')).toBe(false)
  })
})

describe('fetchScratchAsset', () => {
  it('fetches, converts to a data url, and measures an image', async () => {
    expect(await fetchScratchAsset('a1.svg', 1, { fetchFn: okFetch, toDataUrl, measure })).toEqual({
      dataUrl: 'data:fake,BLOB', width: 120, height: 80,
    })
  })

  it('halves retina art, so a 960x720 res-2 backdrop lands at 480x360', async () => {
    const bigMeasure = async () => ({ width: 960, height: 720 })
    expect(
      await fetchScratchAsset('b1.png', 2, { fetchFn: okFetch, toDataUrl, measure: bigMeasure }),
    ).toEqual({ dataUrl: 'data:fake,BLOB', width: 480, height: 360 })
  })

  it('caps oversized art at the stage size, like uploads do', async () => {
    const hugeMeasure = async () => ({ width: 1920, height: 1080 })
    const asset = await fetchScratchAsset('a1.svg', 1, { fetchFn: okFetch, toDataUrl, measure: hugeMeasure })
    expect(asset.width).toBeLessThanOrEqual(480)
    expect(asset.height).toBeLessThanOrEqual(360)
  })

  it('never measures a sound, and records it with no dimensions', async () => {
    const measureSpy = vi.fn(measure)
    expect(
      await fetchScratchAsset('c1.wav', 1, { fetchFn: okFetch, toDataUrl, measure: measureSpy }),
    ).toEqual({ dataUrl: 'data:fake,BLOB', width: 0, height: 0 })
    expect(measureSpy).not.toHaveBeenCalled()
  })

  it('reports a failed download in words a kid can act on', async () => {
    const badFetch = async () => ({ ok: false, status: 503 }) as unknown as Response
    await expect(
      fetchScratchAsset('a1.svg', 1, { fetchFn: badFetch, toDataUrl, measure }),
    ).rejects.toThrow(/couldn't be downloaded/i)
  })
})

describe('ScratchAssetLoader', () => {
  it('shares one in-flight request across concurrent callers', async () => {
    const fetchFn = vi.fn(okFetch)
    const loader = new ScratchAssetLoader({ fetchFn, toDataUrl, measure })
    const [a, b] = await Promise.all([loader.load('a1.svg', 1), loader.load('a1.svg', 1)])
    expect(a).toEqual(b)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('does not re-fetch an asset it already has', async () => {
    const fetchFn = vi.fn(okFetch)
    const loader = new ScratchAssetLoader({ fetchFn, toDataUrl, measure })
    await loader.load('a1.svg', 1)
    await loader.load('a1.svg', 1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('forgets a failed load so a retry can succeed', async () => {
    let attempt = 0
    const flaky = async () => {
      attempt += 1
      if (attempt === 1) return { ok: false, status: 500 } as unknown as Response
      return { ok: true, blob: async () => 'BLOB' } as unknown as Response
    }
    const loader = new ScratchAssetLoader({ fetchFn: flaky, toDataUrl, measure })
    await expect(loader.load('a1.svg', 1)).rejects.toThrow()
    expect((await loader.load('a1.svg', 1)).dataUrl).toBe('data:fake,BLOB')
  })

  it('loadMany returns a store keyed by scratch: source', async () => {
    const loader = new ScratchAssetLoader({ fetchFn: okFetch, toDataUrl, measure })
    const store = await loader.loadMany([{ md5ext: 'a1.svg', res: 1 }, { md5ext: 'c1.wav', res: 1 }])
    expect(store.get('scratch:a1.svg')).toEqual({ dataUrl: 'data:fake,BLOB', width: 120, height: 80 })
    expect(store.get('scratch:c1.wav')).toEqual({ dataUrl: 'data:fake,BLOB', width: 0, height: 0 })
    expect(store.size).toBe(2)
  })
})
