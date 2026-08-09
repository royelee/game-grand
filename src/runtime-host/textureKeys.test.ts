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
