import { describe, it, expect } from 'vitest'
import { buildTextureIndex } from './textureKeys'
import type { RunPayload } from '../shared/protocol'

function payloadWith(
  sprites: { name: string; costumes: { name: string; dataUrl: string }[] }[],
): RunPayload {
  return {
    sprites: sprites.map(s => ({
      name: s.name, x: 0, y: 0, size: 100, direction: 90, visible: true,
      costumes: s.costumes.map(c => ({ name: c.name, width: 1, height: 1, dataUrl: c.dataUrl })),
      currentCostume: 0, script: '',
    })),
    backdrops: [], currentBackdrop: 0, sounds: [], mainScript: '',
  }
}

describe('buildTextureIndex', () => {
  it('gives same-named costumes on different sprites distinct keys when their art differs', () => {
    const payload = payloadWith([
      { name: 'Cat', costumes: [{ name: 'cat-a', dataUrl: 'data:library-cat' }] },
      { name: 'UploadedCat', costumes: [{ name: 'cat-a', dataUrl: 'data:uploaded-cat' }] },
    ])
    const index = buildTextureIndex(payload)
    const libraryKey = index.bySprite.get('Cat')?.get('cat-a')
    const uploadKey = index.bySprite.get('UploadedCat')?.get('cat-a')
    expect(libraryKey).toBeDefined()
    expect(uploadKey).toBeDefined()
    expect(libraryKey).not.toBe(uploadKey)
  })

  it('gives the identical dataUrl the same key, even reused across sprites', () => {
    const payload = payloadWith([
      { name: 'Cat', costumes: [{ name: 'a', dataUrl: 'data:shared' }, { name: 'b', dataUrl: 'data:shared' }] },
      { name: 'Bat', costumes: [{ name: 'c', dataUrl: 'data:shared' }] },
    ])
    const index = buildTextureIndex(payload)
    const key = index.bySprite.get('Cat')?.get('a')
    expect(index.bySprite.get('Cat')?.get('b')).toBe(key)
    expect(index.bySprite.get('Bat')?.get('c')).toBe(key)
    expect(index.keyForDataUrl.size).toBe(1)
  })

  it('resolves through the mapping for a clone, which shares its original sprite name', () => {
    const payload = payloadWith([
      { name: 'Cat', costumes: [{ name: 'cat-a', dataUrl: 'data:library-cat' }] },
    ])
    const index = buildTextureIndex(payload)
    // Clones are runtime-created and share the original's name, so looking
    // that name up in `bySprite` (built once from the payload) still works.
    expect(index.bySprite.get('Cat')?.get('cat-a')).toBe(index.keyForDataUrl.get('data:library-cat'))
  })
})

describe('backdrop and sound identity', () => {
  const payload = {
    sprites: [],
    backdrops: [
      { name: 'sky', width: 480, height: 360, dataUrl: 'data:A' },
      { name: 'sky2', width: 480, height: 360, dataUrl: 'data:B' },
    ],
    currentBackdrop: 0,
    sounds: [
      { name: 'Water drop', dataUrl: 'data:C' },
      { name: 'Water drop2', dataUrl: 'data:D' },
    ],
    mainScript: '',
  } as unknown as RunPayload

  it('gives every distinct backdrop its own texture key', () => {
    const index = buildTextureIndex(payload)
    expect(index.byBackdrop.get('sky')).not.toBe(index.byBackdrop.get('sky2'))
  })

  it('reuses one key for two backdrops sharing the same bytes', () => {
    const same = {
      ...payload,
      backdrops: [
        { name: 'a', width: 1, height: 1, dataUrl: 'data:A' },
        { name: 'b', width: 1, height: 1, dataUrl: 'data:A' },
      ],
    } as unknown as RunPayload
    const index = buildTextureIndex(same)
    expect(index.byBackdrop.get('a')).toBe(index.byBackdrop.get('b'))
  })

  it('does not let a backdrop key collide with a costume key', () => {
    const withSprite = {
      ...payload,
      sprites: [{ name: 'Cat', costumes: [{ name: 'sky', width: 1, height: 1, dataUrl: 'data:Z' }] }],
    } as unknown as RunPayload
    const index = buildTextureIndex(withSprite)
    expect(index.bySprite.get('Cat')?.get('sky')).not.toBe(index.byBackdrop.get('sky'))
  })

  it('maps each sound name to its own data url', () => {
    const index = buildTextureIndex(payload)
    expect(index.bySound.get('Water drop')).toBe('data:C')
    expect(index.bySound.get('Water drop2')).toBe('data:D')
  })
})
