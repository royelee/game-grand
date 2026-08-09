import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildApp } from './app.ts'
import { ProjectStore } from './db.ts'
import type { FastifyInstance } from 'fastify'

const project = () => ({
  version: 1,
  name: 'Cat Chase',
  sprites: [
    {
      name: 'Cat',
      x: 0, y: 0, size: 100, direction: 90, visible: true,
      costumes: [{ name: 'cat-a', source: 'library:cat-a' }],
      currentCostume: 0,
      script: 'onStart(() => {})',
    },
  ],
  stage: { backdrops: [{ name: 'blue-sky', source: 'library:blue-sky' }], currentBackdrop: 0 },
  sounds: [],
  mainScript: '',
})

let app: FastifyInstance
let store: ProjectStore
let clock = 1000

beforeEach(() => {
  store = new ProjectStore(':memory:')
  clock = 1000
  app = buildApp({ store, now: () => clock })
})
afterEach(async () => {
  await app.close()
  store.close()
})

const create = (body: unknown) =>
  app.inject({ method: 'POST', url: '/api/projects', payload: body as object })

describe('POST /api/projects', () => {
  it('stores a project and returns its id', async () => {
    const res = await create(project())
    expect(res.statusCode).toBe(201)
    const { id } = res.json()
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(store.load(id)).not.toBeNull()
  })

  it('rejects a document that is not a game', async () => {
    const res = await create({ nope: true })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBeTruthy()
  })

  it('rejects a document over the size cap', async () => {
    const big = project()
    big.mainScript = 'x'.repeat(11 * 1024 * 1024)
    const res = await create(big)
    expect(res.statusCode).toBe(413)
    expect(res.json().error).toMatch(/too big/i)
  })
})

describe('GET /api/projects/:id', () => {
  it('returns exactly what was stored', async () => {
    const { id } = (await create(project())).json()
    const res = await app.inject({ method: 'GET', url: `/api/projects/${id}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(project())
  })

  it('404s an unknown id without leaking anything', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/doesnotexist0000000000' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/couldn't find/i)
  })
})

describe('PUT /api/projects/:id', () => {
  it('saves changes and moves updatedAt', async () => {
    const { id } = (await create(project())).json()
    clock = 5000
    const edited = { ...project(), name: 'Cat Chase 2' }
    const res = await app.inject({ method: 'PUT', url: `/api/projects/${id}`, payload: edited })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(store.load(id)!.document).name).toBe('Cat Chase 2')
    expect(store.load(id)!.updatedAt).toBe(5000)
    expect(store.load(id)!.createdAt).toBe(1000)
  })

  it('404s an unknown id instead of creating one', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/doesnotexist0000000000',
      payload: project(),
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects an invalid document without touching what is stored', async () => {
    const { id } = (await create(project())).json()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}`,
      payload: { version: 1, name: 'broken' },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(store.load(id)!.document).name).toBe('Cat Chase')
  })
})

describe('health', () => {
  it('still answers', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true })
  })
})
