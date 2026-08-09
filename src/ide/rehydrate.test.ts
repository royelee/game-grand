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

describe('scratch refs', () => {
  const measureStub = async () => ({ width: 4, height: 4 })
  const project = {
    version: 1,
    name: 'g',
    sprites: [{
      name: 'Abby', x: 0, y: 0, size: 100, direction: 90, visible: true,
      costumes: [{ name: 'abby-a', source: 'scratch:a1.svg' }],
      currentCostume: 0, script: '',
    }],
    stage: { backdrops: [{ name: 'blue-sky', source: 'library:blue-sky' }], currentBackdrop: 0 },
    sounds: [{ name: 'pop', source: 'scratch:s1.wav' }],
    mainScript: '',
  } as unknown as Project

  const fakeLoader = {
    load: async (md5ext: string) => ({ dataUrl: `data:fake,${md5ext}`, width: 10, height: 20 }),
  }

  it('fetches every scratch asset the project references', async () => {
    const { additions, issues } = await rehydrateAssetStore(project, measureStub, fakeLoader)
    expect(issues).toEqual([])
    expect(additions.get('scratch:a1.svg')).toEqual({ dataUrl: 'data:fake,a1.svg', width: 10, height: 20 })
    expect(additions.get('scratch:s1.wav')).toEqual({ dataUrl: 'data:fake,s1.wav', width: 10, height: 20 })
  })

  it('leaves library refs to preloadLibrary', async () => {
    const { additions } = await rehydrateAssetStore(project, measureStub, fakeLoader)
    expect(additions.has('library:blue-sky')).toBe(false)
  })

  it('reports a failed download and still opens the rest of the game', async () => {
    const failing = {
      load: async (md5ext: string) => {
        if (md5ext === 'a1.svg') throw new Error('offline')
        return { dataUrl: 'data:fake,ok', width: 1, height: 1 }
      },
    }
    const { additions, issues } = await rehydrateAssetStore(project, measureStub, failing)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/Scratch library/i)
    expect(additions.has('scratch:s1.wav')).toBe(true)
  })
})
