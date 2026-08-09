import { describe, it, expect } from 'vitest'
import { rehydrateAssetStore } from './rehydrate'
import { createEmptyProject } from '../shared/project'
import type { Project } from '../shared/project'

const withUploads = (): Project => {
  const project = createEmptyProject()
  return {
    ...project,
    sprites: [
      {
        name: 'Rocket',
        x: 0, y: 0, size: 100, direction: 90, visible: true,
        costumes: [{ name: 'rocket', source: 'data:image/png;base64,AAA' }],
        currentCostume: 0,
        script: '',
      },
    ],
    stage: {
      backdrops: [
        { name: 'blue-sky', source: 'library:blue-sky' },
        { name: 'photo', source: 'data:image/jpeg;base64,BBB' },
      ],
      currentBackdrop: 0,
    },
    sounds: [{ name: 'boop', source: 'data:audio/wav;base64,CCC' }],
  }
}

describe('rehydrateAssetStore', () => {
  it('does nothing for a project with only library assets', async () => {
    const project = createEmptyProject()
    const measure = async () => ({ width: 10, height: 10 })
    const result = await rehydrateAssetStore(project, measure)
    expect(result.additions.size).toBe(0)
    expect(result.issues).toEqual([])
  })

  it('measures and downscales every uploaded costume and backdrop, skipping library refs', async () => {
    const project = withUploads()
    const calls: string[] = []
    const measure = async (dataUrl: string) => {
      calls.push(dataUrl)
      return { width: 960, height: 720 }
    }
    const result = await rehydrateAssetStore(project, measure)

    // Only the two data: refs were measured — the library: backdrop was skipped.
    expect(calls.sort()).toEqual(
      ['data:image/jpeg;base64,BBB', 'data:image/png;base64,AAA'].sort(),
    )
    expect(result.additions.get('data:image/png;base64,AAA')).toEqual({
      dataUrl: 'data:image/png;base64,AAA', width: 480, height: 360,
    })
    expect(result.additions.get('data:image/jpeg;base64,BBB')).toEqual({
      dataUrl: 'data:image/jpeg;base64,BBB', width: 480, height: 360,
    })
    expect(result.additions.has('library:blue-sky')).toBe(false)
    expect(result.issues).toEqual([])
  })

  it('stores a sound with zero dimensions and never measures it as an image', async () => {
    const project = withUploads()
    let measured = false
    const measure = async () => {
      measured = true
      return { width: 1, height: 1 }
    }
    // Isolate the sound: strip the image refs so a stray measure() call is
    // unambiguously about the sound.
    project.sprites = []
    project.stage.backdrops = [{ name: 'blue-sky', source: 'library:blue-sky' }]

    const result = await rehydrateAssetStore(project, measure)
    expect(measured).toBe(false)
    expect(result.additions.get('data:audio/wav;base64,CCC')).toEqual({
      dataUrl: 'data:audio/wav;base64,CCC', width: 0, height: 0,
    })
  })

  it('distinguishes sounds by membership in project.sounds, not by MIME sniffing', async () => {
    // An "audio/*" data URL used as a costume must still be measured as an
    // image (however implausible) — and a source with no audio-looking MIME
    // at all, used as a sound, must still be stored as a sound. Membership,
    // not content-sniffing, is what decides.
    const project = createEmptyProject()
    project.sprites = [
      {
        name: 'Weird',
        x: 0, y: 0, size: 100, direction: 90, visible: true,
        costumes: [{ name: 'weird', source: 'data:audio/wav;base64,XXX' }],
        currentCostume: 0,
        script: '',
      },
    ]
    project.sounds = [{ name: 'odd', source: 'data:image/png;base64,YYY' }]

    const measure = async (dataUrl: string) =>
      dataUrl === 'data:audio/wav;base64,XXX' ? { width: 20, height: 10 } : { width: 999, height: 999 }

    const result = await rehydrateAssetStore(project, measure)
    expect(result.additions.get('data:audio/wav;base64,XXX')).toEqual({
      dataUrl: 'data:audio/wav;base64,XXX', width: 20, height: 10,
    })
    expect(result.additions.get('data:image/png;base64,YYY')).toEqual({
      dataUrl: 'data:image/png;base64,YYY', width: 0, height: 0,
    })
  })

  it('measures a source referenced more than once only a single time', async () => {
    const project = createEmptyProject()
    project.sprites = [
      {
        name: 'Twins',
        x: 0, y: 0, size: 100, direction: 90, visible: true,
        costumes: [
          { name: 'a', source: 'data:image/png;base64,SAME' },
          { name: 'b', source: 'data:image/png;base64,SAME' },
        ],
        currentCostume: 0,
        script: '',
      },
    ]
    let calls = 0
    const measure = async () => { calls++; return { width: 100, height: 100 } }
    await rehydrateAssetStore(project, measure)
    expect(calls).toBe(1)
  })

  it('reports a decode failure as an issue and still loads the other assets', async () => {
    const project = withUploads()
    const measure = async (dataUrl: string) => {
      if (dataUrl === 'data:image/png;base64,AAA') throw new Error('corrupt image')
      return { width: 100, height: 100 }
    }
    const result = await rehydrateAssetStore(project, measure)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].message).toMatch(/corrupt image/)
    // The other image and the sound still made it in.
    expect(result.additions.has('data:image/jpeg;base64,BBB')).toBe(true)
    expect(result.additions.has('data:audio/wav;base64,CCC')).toBe(true)
    expect(result.additions.has('data:image/png;base64,AAA')).toBe(false)
  })
})
