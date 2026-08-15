import { describe, it, expect } from 'vitest'
import { handleApiRequest } from './api'
import type { ProjectStore, StoredProject } from './projectStore'
import { createEmptyProject } from './project'

function fakeStore(): ProjectStore & { rows: Map<string, StoredProject> } {
  const rows = new Map<string, StoredProject>()
  let n = 0
  return {
    rows,
    async create(document, now) {
      const id = `id${++n}`.padEnd(22, 'x')
      rows.set(id, { id, document, createdAt: now, updatedAt: now })
      return id
    },
    async load(id) {
      return rows.get(id) ?? null
    },
    async update(id, document, now) {
      const row = rows.get(id)
      if (!row) return false
      rows.set(id, { ...row, document, updatedAt: now })
      return true
    },
  }
}

const deps = (store: ProjectStore) => ({ store, now: () => 1000 })
const project = () => createEmptyProject()

async function createOne(store: ProjectStore): Promise<string> {
  const res = await handleApiRequest(
    { method: 'POST', path: '/api/projects', body: project() },
    deps(store),
  )
  return (res?.body as { id: string }).id
}

describe('handleApiRequest', () => {
  it('returns null for anything that is not an API route, so assets can serve it', async () => {
    const store = fakeStore()
    expect(
      await handleApiRequest({ method: 'GET', path: '/p/abc', body: null }, deps(store)),
    ).toBeNull()
    expect(await handleApiRequest({ method: 'GET', path: '/', body: null }, deps(store))).toBeNull()
  })

  it('creates a project and returns its id', async () => {
    const store = fakeStore()
    const res = await handleApiRequest(
      { method: 'POST', path: '/api/projects', body: project() },
      deps(store),
    )
    expect(res?.status).toBe(201)
    expect((res?.body as { id: string }).id).toMatch(/^\S+$/)
  })

  it('refuses a body that is not a project, in words a kid can read', async () => {
    const store = fakeStore()
    const res = await handleApiRequest(
      { method: 'POST', path: '/api/projects', body: { nope: true } },
      deps(store),
    )
    expect(res?.status).toBe(400)
    expect(String((res?.body as { error: string }).error)).not.toMatch(/undefined|Error:|schema/i)
  })

  it('loads a saved project and sends nosniff, because the body is attacker-authored', async () => {
    const store = fakeStore()
    const id = await createOne(store)
    const res = await handleApiRequest(
      { method: 'GET', path: `/api/projects/${id}`, body: null },
      deps(store),
    )
    expect(res?.status).toBe(200)
    expect(res?.headers?.['X-Content-Type-Options']).toBe('nosniff')
  })

  it('returns the stored document verbatim, not a re-encoding of it', async () => {
    const store = fakeStore()
    const id = await createOne(store)
    const res = await handleApiRequest(
      { method: 'GET', path: `/api/projects/${id}`, body: null },
      deps(store),
    )
    expect(res?.body).toBe(store.rows.get(id)!.document)
  })

  it('explains an unknown link instead of leaking that it was a lookup miss', async () => {
    const store = fakeStore()
    const res = await handleApiRequest(
      { method: 'GET', path: '/api/projects/nope', body: null },
      deps(store),
    )
    expect(res?.status).toBe(404)
    expect((res?.body as { error: string }).error).toBe("We couldn't find a game with that link.")
  })

  it('updates an existing project', async () => {
    const store = fakeStore()
    const id = await createOne(store)
    const res = await handleApiRequest(
      { method: 'PUT', path: `/api/projects/${id}`, body: { ...project(), name: 'Renamed' } },
      deps(store),
    )
    expect(res).toEqual({ status: 200, body: { ok: true } })
    expect(JSON.parse(store.rows.get(id)!.document).name).toBe('Renamed')
  })

  it('404s a PUT to a link that does not exist', async () => {
    const store = fakeStore()
    const res = await handleApiRequest(
      { method: 'PUT', path: '/api/projects/nope', body: project() },
      deps(store),
    )
    expect(res?.status).toBe(404)
  })

  it('refuses an oversized project with the size message, not a generic 413', async () => {
    const store = fakeStore()
    const huge = { ...project(), name: 'x'.repeat(11 * 1024 * 1024) }
    const res = await handleApiRequest(
      { method: 'POST', path: '/api/projects', body: huge },
      deps(store),
    )
    expect(res?.status).toBe(413)
    expect((res?.body as { error: string }).error).toBe(
      'That game is too big to save. Try using smaller pictures.',
    )
  })

  it('ignores a query string when matching a route', async () => {
    const store = fakeStore()
    const id = await createOne(store)
    const res = await handleApiRequest(
      { method: 'GET', path: `/api/projects/${id}`, body: null },
      deps(store),
    )
    expect(res?.status).toBe(200)
  })
})
