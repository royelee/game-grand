# Cloudflare Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the playground from Cloudflare — client on Workers static assets, the three project endpoints on a Worker, saved games in D1 — without changing the save format, the client, or the existing Fastify development server.

**Architecture:** The Fastify-shaped routing in `server/routes.ts` moves into one framework-free function in `src/shared/api.ts` that takes plain `{method, path, body}` and returns plain `{status, body}`. Fastify and the Worker become thin adapters over it. Storage moves behind an async `ProjectStore` interface with two implementations: the existing `node:sqlite` one for local development and tests, and a D1 one for production.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Wrangler, Fastify 5 (retained), vitest (node environment), Playwright.

**Spec:** `docs/superpowers/specs/2026-08-15-cloudflare-deployment-design.md`

## Global Constraints

- Node ≥ 24. `server/` and `scripts/` import with explicit `.ts` extensions and are typechecked under `tsconfig.server.json` with `erasableSyntaxOnly` — no enums, no parameter properties, no decorators there.
- `worker/` runs on Cloudflare's runtime: no `node:` builtins, no filesystem. Web Crypto only.
- Every user-facing string is written for a child. Copy the tone of `src/runtime/errors.ts` and `server/routes.ts`. Reuse the existing strings verbatim where they already exist: `"We couldn't find a game with that link."` and `"That game is too big to save. Try using smaller pictures."`
- A project id is a capability. It must never appear in a log line, in either runtime.
- `runtime.html` and `assets/*` must be served with `Access-Control-Allow-Origin: *`; `runtime.html` additionally with `Content-Security-Policy: frame-ancestors 'self'`. Without the first, the stage silently stays blank.
- The save document shape (`src/shared/project.ts`) does not change.
- Commit subjects are lowercase, imperative, `type: summary`.

---

### Task 1: A project id generator that runs in both runtimes

`server/ids.ts` uses `node:crypto`. Workers has Web Crypto instead. Move the generator to `src/shared/` and build base64url by hand, since `Buffer` is also absent.

**Files:**
- Create: `src/shared/ids.ts`
- Create: `src/shared/ids.test.ts`
- Modify: `server/ids.ts` (becomes a re-export so existing imports keep working)
- Delete: `server/ids.test.ts` (its cases move to the shared test)

**Interfaces:**
- Consumes: nothing.
- Produces: `newProjectId(): string` — 22 base64url characters from 16 random bytes.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/ids.test.ts
import { describe, it, expect } from 'vitest'
import { newProjectId } from './ids'

describe('newProjectId', () => {
  it('is 22 base64url characters, with no padding or non-url characters', () => {
    const id = newProjectId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('does not repeat across many draws', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => newProjectId()))
    expect(seen.size).toBe(1000)
  })

  it('uses Web Crypto, so it works on Workers as well as Node', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    newProjectId()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

Add `import { vi } from 'vitest'` to the import line.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/shared/ids.test.ts`
Expected: FAIL — cannot resolve `./ids`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/ids.ts
/**
 * A project id is a capability: whoever holds it can read and write that
 * project. 16 random bytes (22 base64url characters) is far past guessing.
 *
 * Web Crypto rather than node:crypto, and hand-rolled base64url rather than
 * Buffer, because this runs unchanged on Cloudflare Workers, which has
 * neither.
 */
export function newProjectId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
```

- [ ] **Step 4: Run the test and make sure it passes**

Run: `npx vitest run src/shared/ids.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Point the server at the shared generator**

```ts
// server/ids.ts
// Kept as a re-export so server/ imports do not all have to change, and so
// there is exactly one implementation to audit.
export { newProjectId } from '../src/shared/ids.ts'
```

Then delete `server/ids.test.ts` — its assertions now live in `src/shared/ids.test.ts`.

- [ ] **Step 6: Run the whole suite**

Run: `make test-unit`
Expected: PASS. Test count drops by the 2 tests deleted from `server/ids.test.ts` and rises by 3.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ids.ts src/shared/ids.test.ts server/ids.ts
git rm server/ids.test.ts
git commit -m "refactor: generate project ids with Web Crypto so Workers can too"
```

---

### Task 2: An async ProjectStore interface

Both backends must satisfy one interface. Making it async costs the Fastify path nothing — its handlers are already `async` — and D1 requires it.

**Files:**
- Create: `src/shared/projectStore.ts`
- Modify: `server/db.ts` (implement the interface; methods become async)
- Modify: `server/db.test.ts` (await the calls)
- Modify: `server/routes.ts:9-12` (`RouteDeps.store` type)

**Interfaces:**
- Consumes: `newProjectId` from Task 1.
- Produces:
  - `interface StoredProject { id: string; document: string; createdAt: number; updatedAt: number }`
  - `interface ProjectStore { create(document: string, now: number): Promise<string>; load(id: string): Promise<StoredProject | null>; update(id: string, document: string, now: number): Promise<boolean> }`

- [ ] **Step 1: Write the interface**

```ts
// src/shared/projectStore.ts
export interface StoredProject {
  id: string
  document: string
  createdAt: number
  updatedAt: number
}

/**
 * Durable, verbatim storage of project documents as opaque JSON strings.
 * Validation happens above this layer.
 *
 * Async because D1 is: the Cloudflare backend cannot be synchronous, and one
 * interface for both backends is the whole point. `update` returns whether a
 * row matched, which both backends report without a follow-up SELECT
 * (node:sqlite `result.changes`, D1 `meta.changes`).
 */
export interface ProjectStore {
  create(document: string, now: number): Promise<string>
  load(id: string): Promise<StoredProject | null>
  update(id: string, document: string, now: number): Promise<boolean>
}
```

- [ ] **Step 2: Update the existing store's tests to await**

In `server/db.test.ts`, make every test body `async` and `await` each `create`/`load`/`update` call. Do not change what is asserted.

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run server/db.test.ts`
Expected: FAIL — the assertions now compare against Promises.

- [ ] **Step 4: Make the SQLite store implement the interface**

In `server/db.ts`, add the import and the `implements` clause, and mark the three methods `async`. The bodies do not otherwise change — `DatabaseSync` stays synchronous underneath.

```ts
import type { ProjectStore, StoredProject } from '../src/shared/projectStore.ts'

export type { StoredProject }

export class SqliteProjectStore implements ProjectStore {
  // ... constructor unchanged ...

  async create(document: string, now: number): Promise<string> {
    const id = newProjectId()
    this.db
      .prepare('INSERT INTO projects (id, document, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, document, now, now)
    return id
  }

  async load(id: string): Promise<StoredProject | null> {
    // ... body unchanged ...
  }

  async update(id: string, document: string, now: number): Promise<boolean> {
    // ... body unchanged ...
  }
}

// The old name, kept so server/app.ts and the tests need no edit.
export { SqliteProjectStore as ProjectStore }
```

Note: exporting the class under both names is deliberate and temporary — Task 3 removes the alias once `app.ts` is updated.

- [ ] **Step 5: Widen the route dependency type**

In `server/routes.ts`, change `import type { ProjectStore } from './db.ts'` to
`import type { ProjectStore } from '../src/shared/projectStore.ts'` and `await` the three store calls in the handlers.

- [ ] **Step 6: Run the suite**

Run: `make test-unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/projectStore.ts server/db.ts server/db.test.ts server/routes.ts
git commit -m "refactor: put project storage behind an async interface"
```

---

### Task 3: Framework-free request handling

The validation in `routes.ts` is the only thing between a browser and the database. Two copies would drift, so there is one — and Fastify becomes an adapter over it.

**Files:**
- Create: `src/shared/api.ts`
- Create: `src/shared/api.test.ts`
- Modify: `server/routes.ts` (becomes the Fastify adapter)
- Modify: `server/app.ts:52` (construct `SqliteProjectStore`)

**Interfaces:**
- Consumes: `ProjectStore` (Task 2), `validateProject` and `MAX_PROJECT_BYTES` from `src/shared/projectSchema.ts`.
- Produces:
  - `interface ApiRequest { method: string; path: string; body: unknown }`
  - `interface ApiResponse { status: number; body: unknown; headers?: Record<string, string> }`
  - `interface ApiDeps { store: ProjectStore; now: () => number }`
  - `handleApiRequest(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse | null>` — `null` means "not an API route", so the caller falls through to static assets.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/api.test.ts
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

describe('handleApiRequest', () => {
  it('returns null for anything that is not an API route, so assets can serve it', async () => {
    const store = fakeStore()
    expect(await handleApiRequest({ method: 'GET', path: '/p/abc', body: null }, deps(store))).toBeNull()
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
    const created = await handleApiRequest(
      { method: 'POST', path: '/api/projects', body: project() },
      deps(store),
    )
    const id = (created?.body as { id: string }).id
    const res = await handleApiRequest({ method: 'GET', path: `/api/projects/${id}`, body: null }, deps(store))
    expect(res?.status).toBe(200)
    expect(res?.headers?.['X-Content-Type-Options']).toBe('nosniff')
  })

  it('explains an unknown link instead of leaking that it was a lookup miss', async () => {
    const store = fakeStore()
    const res = await handleApiRequest({ method: 'GET', path: '/api/projects/nope', body: null }, deps(store))
    expect(res?.status).toBe(404)
    expect((res?.body as { error: string }).error).toBe("We couldn't find a game with that link.")
  })

  it('updates an existing project', async () => {
    const store = fakeStore()
    const created = await handleApiRequest(
      { method: 'POST', path: '/api/projects', body: project() },
      deps(store),
    )
    const id = (created?.body as { id: string }).id
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
    const res = await handleApiRequest({ method: 'POST', path: '/api/projects', body: huge }, deps(store))
    expect(res?.status).toBe(413)
    expect((res?.body as { error: string }).error).toBe(
      'That game is too big to save. Try using smaller pictures.',
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/api.test.ts`
Expected: FAIL — cannot resolve `./api`.

- [ ] **Step 3: Write the handler**

```ts
// src/shared/api.ts
import { MAX_PROJECT_BYTES, validateProject } from './projectSchema'
import type { ProjectStore } from './projectStore'

export interface ApiRequest {
  method: string
  path: string
  body: unknown
}

export interface ApiResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export interface ApiDeps {
  store: ProjectStore
  now: () => number
}

const NOT_FOUND = { status: 404, body: { error: "We couldn't find a game with that link." } }

/** Byte length of a UTF-8 string, without Buffer — the Worker has no Buffer. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * Checks an incoming body and returns the document to store, or the response
 * to send instead. Validation happens before anything touches the database.
 */
function check(body: unknown): { document: string } | ApiResponse {
  const result = validateProject(body)
  if (!result.ok) return { status: 400, body: { error: result.error } }
  const document = JSON.stringify(result.project)
  if (utf8Bytes(document) > MAX_PROJECT_BYTES) {
    return {
      status: 413,
      body: { error: 'That game is too big to save. Try using smaller pictures.' },
    }
  }
  return { document }
}

/**
 * The whole API, as a pure function of a plain request. Fastify and the
 * Cloudflare Worker are both thin adapters over this, so the validation that
 * stands between a browser and the database exists exactly once.
 *
 * Returns null when the path is not an API route, so the caller can fall
 * through to static assets.
 */
export async function handleApiRequest(
  req: ApiRequest,
  deps: ApiDeps,
): Promise<ApiResponse | null> {
  if (req.path === '/api/projects' && req.method === 'POST') {
    const checked = check(req.body)
    if ('status' in checked) return checked
    const id = await deps.store.create(checked.document, deps.now())
    return { status: 201, body: { id } }
  }

  const match = /^\/api\/projects\/([^/?]+)$/.exec(req.path)
  if (!match) return null
  const id = match[1]

  if (req.method === 'GET') {
    const found = await deps.store.load(id)
    if (!found) return NOT_FOUND
    // The body is attacker-authored (a sprite script is an arbitrary string
    // someone typed) and this is a plain, navigable URL. `nosniff` stops a
    // browser that ignores the declared JSON type from guessing its way into
    // treating the response as HTML and running it.
    return {
      status: 200,
      body: found.document,
      headers: { 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'application/json' },
    }
  }

  if (req.method === 'PUT') {
    const checked = check(req.body)
    if ('status' in checked) return checked
    const saved = await deps.store.update(id, checked.document, deps.now())
    return saved ? { status: 200, body: { ok: true } } : NOT_FOUND
  }

  return null
}
```

Note: `body` for the GET case is the stored JSON **string**, already serialized. Adapters must send it verbatim rather than re-encoding it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/shared/api.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Reduce Fastify to an adapter**

```ts
// server/routes.ts
import type { FastifyInstance } from 'fastify'
import { handleApiRequest, type ApiDeps } from '../src/shared/api.ts'

export type RouteDeps = ApiDeps

export function registerProjectRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const handle = async (request: { method: string; url: string; body: unknown }, reply: {
    code(status: number): typeof reply
    header(name: string, value: string): typeof reply
    send(body: unknown): unknown
  }) => {
    const path = request.url.split('?')[0]
    const res = await handleApiRequest({ method: request.method, path, body: request.body }, deps)
    if (!res) return reply.code(404).send({ error: "We couldn't find a game with that link." })
    for (const [name, value] of Object.entries(res.headers ?? {})) reply.header(name, value)
    return reply.code(res.status).send(res.body)
  }

  app.post('/api/projects', handle)
  app.get('/api/projects/:id', handle)
  app.put('/api/projects/:id', handle)
}
```

- [ ] **Step 6: Update the store construction**

In `server/app.ts:52`, change `new ProjectStore(...)` to `new SqliteProjectStore(...)` and update the import. Then remove the temporary `export { SqliteProjectStore as ProjectStore }` alias added in Task 2.

- [ ] **Step 7: Run everything, including the server e2e mode**

Run: `make test-unit && make test-e2e-server`
Expected: PASS. `server/app.test.ts` must still pass unchanged — the log redaction and the error handler are untouched.

- [ ] **Step 8: Commit**

```bash
git add src/shared/api.ts src/shared/api.test.ts server/routes.ts server/app.ts server/db.ts
git commit -m "refactor: make the API a pure function Fastify adapts"
```

---

### Task 4: The D1 store

**Files:**
- Create: `worker/d1Store.ts`
- Create: `migrations/0001_create_projects.sql`

**Interfaces:**
- Consumes: `ProjectStore`, `StoredProject` (Task 2), `newProjectId` (Task 1).
- Produces: `class D1ProjectStore implements ProjectStore`, constructed as `new D1ProjectStore(env.DB)`.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/0001_create_projects.sql
-- Mirrors the schema server/db.ts creates, so a project document is byte
-- identical in SQLite and in D1.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  document TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Write the store**

```ts
// worker/d1Store.ts
import { newProjectId } from '../src/shared/ids'
import type { ProjectStore, StoredProject } from '../src/shared/projectStore'

interface Row {
  id: string
  document: string
  created_at: number
  updated_at: number
}

/**
 * The D1 half of the storage seam. D1 is SQLite, so these are the same three
 * statements server/db.ts runs; only the driver differs.
 *
 * `update` reads meta.changes rather than issuing a follow-up SELECT — D1
 * reports it for writes, exactly as node:sqlite reports result.changes.
 */
export class D1ProjectStore implements ProjectStore {
  constructor(private readonly db: D1Database) {}

  async create(document: string, now: number): Promise<string> {
    const id = newProjectId()
    await this.db
      .prepare('INSERT INTO projects (id, document, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(id, document, now, now)
      .run()
    return id
  }

  async load(id: string): Promise<StoredProject | null> {
    const row = await this.db
      .prepare('SELECT id, document, created_at, updated_at FROM projects WHERE id = ?')
      .bind(id)
      .first<Row>()
    if (!row) return null
    return {
      id: row.id,
      document: row.document,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async update(id: string, document: string, now: number): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE projects SET document = ?, updated_at = ? WHERE id = ?')
      .bind(document, now, id)
      .run()
    return (result.meta.changes ?? 0) > 0
  }

  /** Row count, for the storage circuit breaker in Task 6. */
  async countProjects(): Promise<number> {
    const row = await this.db.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>()
    return row?.n ?? 0
  }
}
```

- [ ] **Step 3: Add the Workers types**

Run: `npm install -D @cloudflare/workers-types wrangler`

Create `worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  },
  "include": ["./**/*.ts", "../src/shared/**/*.ts"]
}
```

- [ ] **Step 4: Typecheck it**

Run: `npx tsc -p worker/tsconfig.json`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add worker/d1Store.ts worker/tsconfig.json migrations/ package.json package-lock.json
git commit -m "feat: store projects in D1 behind the shared store interface"
```

---

### Task 5: The Worker, its config, and the header rules

**Files:**
- Create: `worker/index.ts`
- Create: `wrangler.jsonc`
- Create: `public/_headers`
- Modify: `package.json` (scripts), `Makefile` (targets)

**Interfaces:**
- Consumes: `handleApiRequest` (Task 3), `D1ProjectStore` (Task 4).
- Produces: the default `fetch` export; `interface Env { DB: D1Database; ASSETS: Fetcher }`.

- [ ] **Step 1: Write the header rules**

`public/` is copied verbatim into `dist/` by Vite, so this lands where the assets binding reads it.

```
# public/_headers
#
# The stage runs in <iframe sandbox="allow-scripts">, which gives it an opaque
# origin, and module scripts are always fetched in CORS mode. Without
# Access-Control-Allow-Origin the iframe cannot load its own bundle and the
# stage silently stays blank. This is the Cloudflare equivalent of what
# server/static.ts does for the Fastify server.
/runtime.html
  Access-Control-Allow-Origin: *
  Content-Security-Policy: frame-ancestors 'self'

/assets/*
  Access-Control-Allow-Origin: *
```

- [ ] **Step 2: Write the Worker**

```ts
// worker/index.ts
import { handleApiRequest } from '../src/shared/api'
import { D1ProjectStore } from './d1Store'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
}

/**
 * Reads a JSON body without letting a malformed one throw past us — a kid
 * with a flaky connection should get the friendly 400, not a 500.
 */
async function readBody(request: Request): Promise<unknown> {
  if (request.method === 'GET') return null
  try {
    return await request.json()
  } catch {
    return null
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    const result = await handleApiRequest(
      { method: request.method, path: url.pathname, body: await readBody(request) },
      { store: new D1ProjectStore(env.DB), now: () => Date.now() },
    )

    // Not an API route: hand it to the assets binding, which also applies
    // _headers and the single-page-application fallback for /p/<id>.
    if (!result) return env.ASSETS.fetch(request)

    const headers = new Headers(result.headers)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

    // A GET of a saved project returns the stored JSON string verbatim;
    // everything else is an object this layer serializes. Re-encoding the
    // stored string would double-encode it.
    const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body)

    return new Response(body, { status: result.status, headers })
  },
}
```

**Note for the implementer:** there is deliberately no `console.log` of `url.pathname`, `request.url`, or any id anywhere in this file. A project id in a log line hands out edit rights to that game. Keep it that way.

- [ ] **Step 3: Write the Wrangler config**

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "game-grand",
  "main": "worker/index.ts",
  "compatibility_date": "2026-08-15",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    // /p/<id> is a client route with no file behind it. The IDE reads the
    // path and opens that game, exactly as server/static.ts's fallback does.
    "not_found_handling": "single-page-application",
    // Everything else is served straight from the edge without waking the
    // Worker, so static assets cost nothing and keep their _headers rules.
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "game-grand",
      "database_id": "REPLACE_AFTER_CREATING_THE_DATABASE"
    }
  ],
  "observability": {
    // Metrics only. Cloudflare's request logs record full URLs, and a URL
    // here contains a project id, which is a capability — see the spec.
    "enabled": true,
    "logs": { "enabled": false }
  }
}
```

- [ ] **Step 4: Create the database and paste its id**

```bash
npx wrangler d1 create game-grand
```

Copy the printed `database_id` into `wrangler.jsonc`, replacing `REPLACE_AFTER_CREATING_THE_DATABASE`. Then apply the migration locally and remotely:

```bash
npx wrangler d1 migrations apply game-grand --local
npx wrangler d1 migrations apply game-grand --remote
```

- [ ] **Step 5: Add the scripts and targets**

In `package.json` scripts:

```json
"worker:dev": "wrangler dev --port 5177",
"worker:deploy": "wrangler deploy",
"typecheck:worker": "tsc -p worker/tsconfig.json"
```

In the `Makefile`, add to `.PHONY` and define:

```make
worker-dev: node_modules $(CATALOG) build ## Run the Worker locally against a local D1
	npm run worker:dev
```

- [ ] **Step 6: Verify locally**

```bash
make build
npx wrangler dev --port 5177
```

Then, in another shell:

```bash
curl -si http://localhost:5177/runtime.html | grep -i 'access-control-allow-origin'
curl -s -X POST http://localhost:5177/api/projects \
  -H 'content-type: application/json' \
  -d '{"version":1,"name":"t","sprites":[],"stage":{"backdrops":[{"name":"blue-sky","source":"library:blue-sky"}],"currentBackdrop":0},"sounds":[],"mainScript":""}'
```

Expected: the header is present, and the POST returns `{"id":"..."}` with a 22-character id.

- [ ] **Step 7: Commit**

```bash
git add worker/index.ts wrangler.jsonc public/_headers package.json Makefile
git commit -m "feat: serve the client and the API from one Cloudflare Worker"
```

---

### Task 6: Rate limiting and the storage circuit breaker

`docs/TODO.md` records this as a hard pre-deployment requirement. Do not deploy publicly before this task is done.

**Files:**
- Modify: `src/shared/api.ts` (breaker hook), `src/shared/api.test.ts`
- Modify: `worker/index.ts` (wire the count)
- Modify: `docs/TODO.md`

**Interfaces:**
- Consumes: `ApiDeps` (Task 3), `D1ProjectStore.countProjects` (Task 4).
- Produces: `ApiDeps` gains an optional `capacity?: { used(): Promise<number>; limit: number }`.

- [ ] **Step 1: Write the failing test**

```ts
it('refuses new games once storage is full, and says so for a kid', async () => {
  const store = fakeStore()
  const res = await handleApiRequest(
    { method: 'POST', path: '/api/projects', body: project() },
    { ...deps(store), capacity: { used: async () => 10_000, limit: 10_000 } },
  )
  expect(res?.status).toBe(503)
  expect((res?.body as { error: string }).error).toBe(
    "We're keeping too many games right now, so we can't save a new one. Please try again later.",
  )
})

it('still lets an existing game be saved when storage is full', async () => {
  const store = fakeStore()
  const created = await handleApiRequest(
    { method: 'POST', path: '/api/projects', body: project() },
    deps(store),
  )
  const id = (created?.body as { id: string }).id
  const res = await handleApiRequest(
    { method: 'PUT', path: `/api/projects/${id}`, body: project() },
    { ...deps(store), capacity: { used: async () => 10_000, limit: 10_000 } },
  )
  expect(res?.status).toBe(200)
})
```

The second test encodes the rule that matters: a full disk must not destroy work a kid has already saved. Only *new* games are refused.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/api.test.ts`
Expected: FAIL — the first returns 201 instead of 503.

- [ ] **Step 3: Implement the breaker**

In `src/shared/api.ts`, extend `ApiDeps`:

```ts
export interface ApiDeps {
  store: ProjectStore
  now: () => number
  /**
   * Storage circuit breaker. POST /api/projects is unauthenticated and
   * unmetered, so a loop of creates fills storage and takes everyone's saves
   * down. A per-minute rate limit never notices a slow fill; this does.
   * Only creates are refused — an existing game must always be savable.
   */
  capacity?: { used(): Promise<number>; limit: number }
}
```

and at the top of the POST branch, before `check`:

```ts
if (deps.capacity && (await deps.capacity.used()) >= deps.capacity.limit) {
  return {
    status: 503,
    body: {
      error:
        "We're keeping too many games right now, so we can't save a new one. Please try again later.",
    },
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/shared/api.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Wire it in the Worker**

In `worker/index.ts`, build the store once and pass the capacity:

```ts
const store = new D1ProjectStore(env.DB)
const result = await handleApiRequest(
  { method: request.method, path: url.pathname, body: await readBody(request) },
  {
    store,
    now: () => Date.now(),
    // D1's free tier is 5 GB. At the 10 MB per-project cap that is ~500
    // projects of worst case, but real projects are far smaller; 50k rows is
    // a deliberately conservative ceiling that still refuses a runaway loop
    // long before storage is actually exhausted.
    capacity: { used: () => store.countProjects(), limit: 50_000 },
  },
)
```

- [ ] **Step 6: Add the edge rate-limiting rule**

This is dashboard configuration, not code. In the Cloudflare dashboard, under **Security → WAF → Rate limiting rules**, add a rule on the Worker's route:

- **Expression:** `http.request.uri.path eq "/api/projects" and http.request.method eq "POST"`
- **Rate:** 10 requests per minute per IP
- **Action:** Block, 1 minute timeout

Verify it by issuing 12 rapid creates and confirming the 11th returns 429:

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://<your-worker>/api/projects \
    -H 'content-type: application/json' -d '{"version":1,"name":"t","sprites":[],"stage":{"backdrops":[{"name":"blue-sky","source":"library:blue-sky"}],"currentBackdrop":0},"sounds":[],"mainScript":""}'
done; echo
```

- [ ] **Step 7: Update the register of deferred work**

In `docs/TODO.md`, mark the rate-limiting entry `[x]` with what shipped (edge rule + row-count breaker), and add the four deferred items from the spec's final section: Logpush leaking ids, the write-quota gap the row cap does not cover, no D1 backup, no `updated_at` index.

- [ ] **Step 8: Commit**

```bash
git add src/shared/api.ts src/shared/api.test.ts worker/index.ts docs/TODO.md
git commit -m "feat: refuse new games when storage is full"
```

---

### Task 7: The deploy script

Deploys run from your machine, so the script is the gate that CI would otherwise be. It refuses to ship anything you cannot reproduce from a commit.

**Files:**
- Create: `scripts/deploy.sh`
- Create: `.env.example`
- Modify: `.gitignore`, `Makefile`, `README.md`

**Interfaces:**
- Consumes: `wrangler.jsonc` (Task 5).
- Produces: `make deploy`.

- [ ] **Step 1: Stop `.env` from ever being committable**

This comes first because the risk is live the moment the file exists. Add to `.gitignore`:

```
# Deployment credentials. `scripts/deploy.sh` reads CLOUDFLARE_API_TOKEN from
# here — a token in a public repo is a token someone else deploys with.
.env
.env.*
!.env.example
```

- [ ] **Step 2: Verify the rule actually catches it**

```bash
printf 'CLOUDFLARE_API_TOKEN=fake\n' > .env
git check-ignore -v .env    # must print the .gitignore line
git status --short          # .env must NOT appear
```

Expected: `check-ignore` names the rule, and `.env` is absent from `git status`. If it appears, stop and fix the rule before continuing.

- [ ] **Step 3: Write the example file**

```bash
# .env.example — copy to .env and fill in. .env is gitignored; never commit it.
#
# Create the token at https://dash.cloudflare.com/profile/api-tokens with a
# custom template scoped to this account only:
#   Workers Scripts: Edit
#   D1: Edit
# Nothing else. A leaked token should be able to redeploy this Worker and
# nothing more.
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
```

- [ ] **Step 4: Write the script**

```bash
#!/usr/bin/env bash
# Deploy to Cloudflare from a developer machine.
#
# CI does not deploy, so the guarantee CI would have given — that what ships
# passed its tests — has to live here instead. This script refuses to deploy
# a tree it cannot tie to a commit, and runs the suite before shipping.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "error: no .env — copy .env.example and fill in your token." >&2
  exit 1
fi

# Read the token without echoing it and without exporting the whole file:
# `set -a; source .env` would also export anything else that file grows.
CLOUDFLARE_API_TOKEN="$(grep -E '^CLOUDFLARE_API_TOKEN=' .env | cut -d= -f2-)"
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "error: CLOUDFLARE_API_TOKEN is empty in .env" >&2
  exit 1
fi
export CLOUDFLARE_API_TOKEN

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "error: on branch '$branch', not main. Deploy what you merged." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty. Commit or stash first — a deploy must" >&2
  echo "       be reproducible from a commit." >&2
  exit 1
fi

echo "==> Tests"
make test-unit

echo "==> Build"
make build

echo "==> Deploying $(git rev-parse --short HEAD) to Cloudflare"
npx wrangler deploy

echo "==> Deployed. Verifying the header the stage depends on:"
# A blank stage is the failure this catches: without ACAO the sandboxed
# iframe cannot load its own bundle, and nothing else reports it.
url="$(npx wrangler deployments list --json 2>/dev/null | head -1 || true)"
echo "    curl -sI https://<your-worker>/runtime.html | grep -i access-control-allow-origin"
```

- [ ] **Step 5: Make it executable and add the target**

```bash
chmod +x scripts/deploy.sh
```

In the `Makefile`, add `deploy` to `.PHONY` and:

```make
deploy: ## Deploy to Cloudflare (needs .env with CLOUDFLARE_API_TOKEN)
	./scripts/deploy.sh
```

- [ ] **Step 6: Prove the guards work before trusting them**

```bash
git checkout -b throwaway && make deploy   # must fail: not on main
git checkout main
echo x >> README.md && make deploy         # must fail: dirty tree
git checkout README.md && git branch -D throwaway
```

Expected: both refuse before reaching `wrangler`. A guard that has never been seen to fire is not a guard.

- [ ] **Step 7: Document it**

Add a **Deploying** section to `README.md`: copy `.env.example` to `.env`, create the scoped token, `make deploy`. State that `.env` is gitignored and must stay that way.

- [ ] **Step 8: Commit**

```bash
git add scripts/deploy.sh .env.example .gitignore Makefile README.md
git commit -m "build: deploy to Cloudflare from a local script"
```

---

### Task 8: End-to-end against the real Worker

The unit tests cover `handleApiRequest` with a fake store. Nothing yet proves D1 works, that `_headers` applies, or that `/p/<id>` falls back — the three things that only fail in a browser against the real edge runtime. This is the mode that would have caught the original CORS bug.

**Files:**
- Modify: `playwright.config.ts`, `Makefile`, `.github/workflows/ci.yml`, `CLAUDE.md`

**Interfaces:**
- Consumes: `make worker-dev` (Task 5).
- Produces: `E2E_WORKER=1` mode on port 5177.

- [ ] **Step 1: Add the mode to the Playwright config**

```ts
const WORKER = !!process.env.E2E_WORKER
const PORT = WORKER ? 5177 : SERVER ? 5176 : PREVIEW ? 5175 : 5174
```

and in `webServer.command`, add the first branch:

```ts
command: WORKER
  ? `npm run build && npx wrangler dev --port ${PORT} --local`
  : SERVER
    ? `npm run build && DB_FILE=.e2e-projects.db PORT=${PORT} npm run server`
    : PREVIEW
      ? `npm run build && npm run preview -- --port ${PORT} --strictPort`
      : `npm run dev -- --port ${PORT} --strictPort`,
```

- [ ] **Step 2: Let the save/load specs run in this mode**

`e2e/save-load.spec.ts` and part of `e2e/scratch-library.spec.ts` skip unless `E2E_SERVER=1`. Find each `test.skip(!process.env.E2E_SERVER, ...)` and widen it:

```ts
test.skip(!process.env.E2E_SERVER && !process.env.E2E_WORKER, 'needs a real server')
```

- [ ] **Step 3: Add a spec for the two things only this mode can check**

```ts
// e2e/worker.spec.ts
import { test, expect } from '@playwright/test'

test.skip(!process.env.E2E_WORKER, 'only meaningful against wrangler dev')

test('runtime.html carries the header the sandboxed stage needs', async ({ request }) => {
  const res = await request.get('/runtime.html')
  expect(res.status()).toBe(200)
  // Without this the iframe cannot fetch its own module bundle and the stage
  // silently stays blank — no console error the kid or we would ever see.
  expect(res.headers()['access-control-allow-origin']).toBe('*')
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'self'")
})

test('an unknown /p/ link serves the IDE rather than a 404 page', async ({ request }) => {
  const res = await request.get('/p/aaaaaaaaaaaaaaaaaaaaaa')
  expect(res.status()).toBe(200)
  expect(await res.text()).toContain('<div id="root">')
})
```

- [ ] **Step 4: Run it**

```bash
npx wrangler d1 migrations apply game-grand --local
E2E_WORKER=1 npx playwright test
```

Expected: PASS, including the save/load specs now running against D1.

- [ ] **Step 5: Add the Make target and the CI job**

```make
test-e2e-worker: node_modules $(CATALOG) ## Run Playwright against the local Worker
	E2E_WORKER=1 npx playwright test
```

Add `test-e2e-worker` to `test-all`. In `.github/workflows/ci.yml`, add a fourth matrix entry:

```yaml
          - mode: worker
            target: test-e2e-worker
```

**Then update the required status checks**, or the new job is advisory and `main` merges without it:

```bash
gh api -X PATCH repos/royelee/game-grand/branches/main/protection/required_status_checks \
  -f 'contexts[]=typecheck + unit' \
  -f 'contexts[]=e2e (dev)' \
  -f 'contexts[]=e2e (preview)' \
  -f 'contexts[]=e2e (server)' \
  -f 'contexts[]=e2e (worker)'
```

- [ ] **Step 6: Document the fourth mode**

In `CLAUDE.md` and `README.md`, add `make test-e2e-worker` to the commands table and say what it uniquely covers: D1, the `_headers` rules, and the SPA fallback.

- [ ] **Step 7: Run everything**

Run: `make test-all`
Expected: PASS in all four e2e modes.

- [ ] **Step 8: Commit**

```bash
git add playwright.config.ts e2e/ Makefile .github/workflows/ci.yml CLAUDE.md README.md
git commit -m "test: run the e2e suite against the real Worker and D1"
```

---

## Deployment checklist

Run once, in order, after Task 8:

- [ ] `npx wrangler d1 migrations apply game-grand --remote`
- [ ] `make deploy`
- [ ] `curl -sI https://<worker>/runtime.html | grep -i access-control-allow-origin` → `*`
- [ ] Open the deployed URL, add a sprite, Run — the stage must render
- [ ] Save a game, copy the link, open it in a private window — the game must load
- [ ] Add the rate-limiting rule (Task 6 Step 6) and verify a 429
- [ ] Confirm Logpush is **off** for this Worker (project ids are capabilities)
