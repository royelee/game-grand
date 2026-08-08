import { describe, it, expect } from 'vitest'
import { downscale, measureImage } from './upload'

describe('downscale', () => {
  it('leaves small images alone', () => {
    expect(downscale(100, 80, 480, 360)).toEqual({ width: 100, height: 80 })
  })

  it('fits wide images to the width limit, preserving aspect', () => {
    expect(downscale(960, 360, 480, 360)).toEqual({ width: 480, height: 180 })
  })

  it('fits tall images to the height limit', () => {
    expect(downscale(360, 720, 480, 360)).toEqual({ width: 180, height: 360 })
  })

  it('rounds to whole pixels', () => {
    const r = downscale(1000, 333, 480, 360)
    expect(Number.isInteger(r.width)).toBe(true)
    expect(Number.isInteger(r.height)).toBe(true)
  })
})

describe('measureImage', () => {
  it('resolves the natural size of a loaded image', async () => {
    const loadImage = async () => ({ naturalWidth: 64, naturalHeight: 32 })
    expect(await measureImage('data:image/png;base64,x', loadImage)).toEqual({
      width: 64, height: 32,
    })
  })

  it('rejects when the image cannot be decoded', async () => {
    const loadImage = async () => { throw new Error('bad image') }
    await expect(measureImage('data:nonsense', loadImage)).rejects.toThrow(/bad image/)
  })
})
