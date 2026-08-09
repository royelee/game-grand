import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Writable } from 'node:stream'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  app = buildApp({ store, now: () => clock, staticRoot: null })
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

describe('logging', () => {
  it('never writes a project id to the log', async () => {
    // Overriding `app.log.info` does not work here: Fastify's automatic
    // request/response logging runs on a per-request *child* logger, and
    // reassigning the parent's `.info` method does not intercept it — it was
    // verified empirically to capture zero lines while pino kept writing the
    // real log to its actual destination underneath. A real pino destination
    // stream is the only way to see what Fastify genuinely emits.
    const lines: string[] = []
    const stream = new Writable({
      write(chunk: Buffer, _enc, callback) {
        lines.push(chunk.toString())
        callback()
      },
    })

    const logged = buildApp({ store, now: () => clock, logger: { stream }, staticRoot: null })

    const { id } = (await logged.inject({ method: 'POST', url: '/api/projects', payload: project() })).json()
    await logged.inject({ method: 'GET', url: `/api/projects/${id}` })
    await logged.close()

    expect(id).toBeTruthy()
    // Prove the capture itself isn't vacuous: real request/response lines
    // must actually have landed in the stream.
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.some(line => line.includes('/api/projects/[id]'))).toBe(true)
    for (const line of lines) expect(line).not.toContain(id)
  })
})

function fakeDist(): string {
  const root = mkdtempSync(join(tmpdir(), 'dist-'))
  mkdirSync(join(root, 'assets'))
  mkdirSync(join(root, 'library'))
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>IDE</title>')
  writeFileSync(join(root, 'runtime.html'), '<!doctype html><title>Stage</title>')
  writeFileSync(join(root, 'assets', 'runtime-abc.js'), 'console.log(1)')
  // Decoys for the header-anchoring tests: a nested file that merely happens
  // to be named runtime.html, and a file whose name merely contains
  // runtime.html as a substring — neither should get the CORS/CSP headers.
  writeFileSync(join(root, 'library', 'runtime.html'), '<!doctype html><title>Nested</title>')
  writeFileSync(join(root, 'my-weird-runtime.html'), '<!doctype html><title>Weird</title>')
  return root
}

describe('static serving', () => {
  let staticApp: FastifyInstance
  let staticStore: ProjectStore

  beforeEach(() => {
    staticStore = new ProjectStore(':memory:')
    staticApp = buildApp({ store: staticStore, staticRoot: fakeDist() })
  })
  afterEach(async () => {
    await staticApp.close()
    staticStore.close()
  })

  it('serves the IDE at the root', async () => {
    const res = await staticApp.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('IDE')
  })

  it('serves runtime.html with the headers the sandboxed stage needs', async () => {
    const res = await staticApp.inject({ method: 'GET', url: '/runtime.html' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'self'")
  })

  it('serves the stage bundle cross-origin, or the stage never boots', async () => {
    const res = await staticApp.inject({ method: 'GET', url: '/assets/runtime-abc.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('serves the IDE for a project link so the app can route', async () => {
    const res = await staticApp.inject({ method: 'GET', url: '/p/abcdefghijklmnopqrstuv' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('IDE')
  })

  it('still answers api routes as json', async () => {
    const res = await staticApp.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBeTruthy()
  })

  it('404s a missing asset instead of masking it as the IDE', async () => {
    const res = await staticApp.inject({ method: 'GET', url: '/assets/does-not-exist.js' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBeTruthy()
  })

  it('404s any other missing file instead of masking it as the IDE', async () => {
    const res = await staticApp.inject({ method: 'GET', url: '/nope.js' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBeTruthy()
  })

  it('does not give a nested file named runtime.html the sandbox headers', async () => {
    const res = await staticApp.inject({ method: 'GET', url: '/library/runtime.html' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.headers['content-security-policy']).toBeUndefined()
  })

  it('does not give a file that merely contains runtime.html the sandbox headers', async () => {
    const res = await staticApp.inject({ method: 'GET', url: '/my-weird-runtime.html' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.headers['content-security-policy']).toBeUndefined()
  })

  it('still gives the real root runtime.html both headers', async () => {
    const res = await staticApp.inject({ method: 'GET', url: '/runtime.html' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'self'")
  })
})
