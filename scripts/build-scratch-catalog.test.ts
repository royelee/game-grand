import { describe, it, expect } from 'vitest'
import { buildCatalog } from './build-scratch-catalog.ts'

const raw = {
  sprites: [
    {
      name: 'Abby',
      tags: ['people', 'person'],
      isStage: false,
      variables: {},
      blocks: { someBlockId: { opcode: 'event_whenflagclicked' } },
      costumes: [
        { assetId: 'a1', name: 'abby-a', bitmapResolution: 1, md5ext: 'a1.svg', dataFormat: 'svg', rotationCenterX: 31, rotationCenterY: 100 },
        { assetId: 'a2', name: 'abby-b', bitmapResolution: 1, md5ext: 'a2.svg', dataFormat: 'svg', rotationCenterX: 31, rotationCenterY: 100 },
      ],
      sounds: [{ assetId: 's1', name: 'pop', dataFormat: 'wav', md5ext: 's1.wav', sampleCount: 258, rate: 11025 }],
    },
  ],
  costumes: [
    { name: 'Abby-a', tags: ['people'], assetId: 'a1', bitmapResolution: 1, dataFormat: 'svg', md5ext: 'a1.svg', rotationCenterX: 31, rotationCenterY: 100 },
  ],
  backdrops: [
    { name: 'Arctic', tags: ['outdoors'], assetId: 'b1', bitmapResolution: 2, dataFormat: 'png', md5ext: 'b1.png', rotationCenterX: 480, rotationCenterY: 360 },
  ],
  sounds: [
    { name: 'A Bass', tags: ['music'], assetId: 'c1', dataFormat: '', md5ext: 'c1.wav', sampleCount: 56320, rate: 44100 },
  ],
}

describe('buildCatalog', () => {
  it('keeps sprite identity, tags, costumes and sounds', () => {
    const cat = buildCatalog(raw)
    expect(cat.sprites).toEqual([
      {
        name: 'Abby',
        tags: ['people', 'person'],
        costumes: [
          { name: 'abby-a', md5ext: 'a1.svg', res: 1 },
          { name: 'abby-b', md5ext: 'a2.svg', res: 1 },
        ],
        sounds: [{ name: 'pop', md5ext: 's1.wav' }],
      },
    ])
  })

  it('strips scratch block definitions and variables', () => {
    const json = JSON.stringify(buildCatalog(raw))
    expect(json).not.toContain('event_whenflagclicked')
    expect(json).not.toContain('blocks')
    expect(json).not.toContain('variables')
  })

  it('carries bitmapResolution as res, so retina art can be halved on load', () => {
    expect(buildCatalog(raw).backdrops[0]).toEqual({
      name: 'Arctic', tags: ['outdoors'], md5ext: 'b1.png', res: 2,
    })
  })

  it('defaults a missing bitmapResolution to 1', () => {
    const noRes = { ...raw, costumes: [{ ...raw.costumes[0], bitmapResolution: undefined }] }
    expect(buildCatalog(noRes).costumes[0].res).toBe(1)
  })

  it('precomputes sound duration from sampleCount and rate', () => {
    // 56320 / 44100 = 1.2770..., rounded to 2dp
    expect(buildCatalog(raw).sounds[0]).toEqual({
      name: 'A Bass', tags: ['music'], md5ext: 'c1.wav', seconds: 1.28,
    })
  })

  it('records the pinned source and the license', () => {
    const cat = buildCatalog(raw)
    expect(cat.source).toBe('scratch-gui@dae2a97a5bb0cd8a7513fafd60f9e7488f2a89a4')
    expect(cat.license).toBe('CC-BY-SA-4.0')
  })
})
