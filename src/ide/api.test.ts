import { describe, it, expect, vi } from 'vitest'
import { ApiError, createProject, loadProject, saveProject, projectUrl } from './api'
import { addSprite, createEmptyProject } from '../shared/project'

const project = () => addSprite(createEmptyProject(), 'Cat', [{ name: 'cat-a', source: 'library:cat-a' }])

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response

describe('createProject', () => {
  it('posts the project and returns the new id', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(201, { id: 'abc123' }))
    const id = await createProject(project(), fetchFn as unknown as typeof fetch)
    expect(id).toBe('abc123')
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/projects')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body)).sprites[0].name).toBe('Cat')
  })

  it('throws the server message so the kid sees it', async () => {
    const fetchFn = async () => jsonResponse(413, { error: 'That game is too big to save.' })
    await expect(createProject(project(), fetchFn as unknown as typeof fetch)).rejects.toThrow(
      /too big/i,
    )
  })

  it('turns a network failure into a friendly error', async () => {
    const fetchFn = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(createProject(project(), fetchFn as unknown as typeof fetch)).rejects.toMatchObject(
      { status: 0 },
    )
  })
})

describe('loadProject', () => {
  it('returns the project', async () => {
    const fetchFn = async () => jsonResponse(200, project())
    const loaded = await loadProject('abc123', fetchFn as unknown as typeof fetch)
    expect(loaded.sprites[0].name).toBe('Cat')
  })

  it('rejects a document that is not a game', async () => {
    const fetchFn = async () => jsonResponse(200, { nope: true })
    await expect(loadProject('abc', fetchFn as unknown as typeof fetch)).rejects.toBeInstanceOf(
      ApiError,
    )
  })

  it('reports a missing game readably', async () => {
    const fetchFn = async () => jsonResponse(404, { error: "We couldn't find a game with that link." })
    await expect(loadProject('abc', fetchFn as unknown as typeof fetch)).rejects.toThrow(/couldn't find/i)
  })
})

describe('saveProject', () => {
  it('puts to the project url', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { ok: true }))
    await saveProject('abc123', project(), fetchFn as unknown as typeof fetch)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/projects/abc123')
    expect(init.method).toBe('PUT')
  })
})

describe('projectUrl', () => {
  it('builds the link shape once', () => {
    expect(projectUrl('abc123')).toBe('/p/abc123')
  })
})
