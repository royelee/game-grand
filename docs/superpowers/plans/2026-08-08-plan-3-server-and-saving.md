# Server & Saving Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the playground persistence — a small Fastify + SQLite server that stores projects and serves the built app, plus the Save/Load UI, so a kid can close the tab and open their game later on any device from a private link.

**Architecture:** One deployable. Fastify serves the built client from `dist/` and exposes three JSON endpoints over a SQLite table. A project is one JSON document, exactly the `Project` shape the IDE already uses. There are no accounts: saving mints a random unguessable id and the edit URL `/p/<id>` is the key. The browser keeps a local list of recently-opened games for convenience only — the link is the source of truth.

**Tech Stack:** Node (runs TypeScript natively — no build step for the server), Fastify, `@fastify/static`, `node:sqlite` (built in — no native module to compile), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-08-game-playground-design.md`
**Builds on:** Plans 1 and 2, merged to `main`. `src/shared/project.ts` defines `Project`; the IDE holds one in a reducer (`src/ide/store.ts`) and never persists it.

## Global Constraints

- **The server never trusts the client.** Every stored document is validated against the project schema and rejected with a readable message if it does not match. Scripts are stored as plain strings and never executed, imported, or evaluated server-side.
- **A project id is a capability.** Ids come from `crypto.randomBytes(16).toString('base64url')` (22 unguessable characters). Anyone with the id may read and write that project — that is the intended design. Never log a full id, never list ids, and never expose an endpoint that enumerates projects.
- **Per-project size cap: 10 MB**, enforced server-side on create and update (HTTP 413). This matches the spec's cap and stops a runaway upload filling the disk.
- **The server MUST send these headers** (both recorded in `docs/TODO.md` as hard requirements, both discovered by the Plan 2 e2e suite):
  - `Access-Control-Allow-Origin: *` on `runtime.html` **and** the built assets it loads. The stage runs in `<iframe sandbox="allow-scripts">` with an opaque origin, and module scripts are always fetched in CORS mode; without this the stage silently never boots.
  - `Content-Security-Policy: frame-ancestors 'self'` on `runtime.html`, so another origin cannot frame it.
- The `Project` shape and its `version: 1` field are unchanged by this plan. If you believe the shape must change, stop and report it.
- Logic lives in pure modules with unit tests; HTTP handlers stay thin and are tested through `fastify.inject` (no network, no ports). No jsdom, no @testing-library.
- TDD every task: failing test → implement → pass → commit. One commit per task minimum.
- `src/runtime/**` and `src/runtime-host/**` stay untouched.

## File Structure

```
server/index.ts             # entry: build the app, listen                    (Task 1)
server/app.ts               # buildApp(deps) -> Fastify instance              (Task 1, grown by 4-5)
server/db.ts                # SQLite schema + ProjectStore                     (Task 2)
server/ids.ts               # id generation                                    (Task 2)
src/shared/projectSchema.ts # runtime validation of a Project document         (Task 3)
src/ide/api.ts              # client-side fetch wrapper for the three routes   (Task 6)
src/ide/recentGames.ts      # local "my games" list (pure over a Storage)      (Task 6)
src/ide/components/SaveBar.tsx      # name field, Save, link, Load             (Task 7)
src/ide/components/LoadDialog.tsx   # recent games + open-by-link              (Task 7)
tsconfig.server.json        # typecheck the server (Node types, no emit)       (Task 1)
e2e/save-load.spec.ts       # round trip against the real server               (Task 8)
```

Tests are colocated (`server/db.test.ts`, `src/ide/api.test.ts`, …).

**Why the server needs no build step:** Node executes `.ts` directly by stripping types. Two consequences the tasks depend on: imports between server files must carry an explicit `.ts` extension, and only erasable syntax is allowed (no `enum`, no `namespace`, no constructor parameter properties). Type-only imports must be written `import type { … }` so they are erased rather than resolved at runtime.

---

### Task 1: Server scaffold and health check

**Files:**
- Create: `server/app.ts`, `server/index.ts`, `tsconfig.server.json`, `server/app.test.ts`
- Modify: `package.json` (deps + scripts), `Makefile`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildApp(): FastifyInstance` (no side effects, no listening — this is what tests inject into) and `server/index.ts` which listens on `PORT` (default 8080). Tasks 4-5 add routes to `buildApp`.

- [ ] **Step 1: Install dependencies**

Run: `npm install fastify @fastify/static`
Expected: both land in `dependencies`. Nothing else is needed — SQLite is built into Node.

- [ ] **Step 2: Write the failing test**

`server/app.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from './app.ts'

describe('server', () => {
  it('answers a health check', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    await app.close()
  })

  it('returns a readable 404 for an unknown api route', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/not found/i)
    await app.close()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/app.test.ts`
Expected: FAIL — cannot resolve `./app.ts`.

- [ ] **Step 4: Write the implementation**

`server/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify'

export interface AppOptions {
  logger?: boolean
}

/**
 * Builds the server without listening, so tests can drive it through
 * `app.inject()` instead of binding a port.
 */
export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false })

  app.get('/api/health', async () => ({ ok: true }))

  // Task 5 replaces this with the single-page-app fallback for non-API paths.
  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ error: 'That page was not found.' }),
  )

  return app
}
```

`server/index.ts`:
```ts
import { buildApp } from './app.ts'

const port = Number(process.env.PORT ?? 8080)
const host = process.env.HOST ?? '0.0.0.0'

const app = buildApp({ logger: true })

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
```

`tsconfig.server.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowImportingTsExtensions": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["server"]
}
```

- [ ] **Step 5: Wire the scripts**

Add to `package.json` scripts:
```json
    "server": "node server/index.ts",
    "server:dev": "node --watch server/index.ts",
    "typecheck:server": "tsc -p tsconfig.server.json"
```
and change `build` to also typecheck the server:
```json
    "build": "tsc --noEmit && tsc -p tsconfig.server.json && vite build"
```

Install Node types if `typecheck:server` complains they are missing: `npm install -D @types/node`.

Add to the `Makefile` (keep the existing help formatting):
```make
server: build ## Build the client, then run the server on PORT (default 8080)
	npm run server

server-dev: node_modules ## Run the server with reload (client must be built)
	npm run server:dev
```
and add `server`/`server-dev` to the `.PHONY` list.

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run server/app.test.ts && npm run typecheck:server && npm test`
Expected: PASS. Also run `npm run server` once and confirm `curl -s localhost:8080/api/health` returns `{"ok":true}`, then stop it. Report what you saw.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Fastify server scaffold with health check"
```

---

### Task 2: SQLite project store

**Files:**
- Create: `server/db.ts`, `server/ids.ts`, `server/db.test.ts`, `server/ids.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `newProjectId(): string`; `interface StoredProject { id: string; document: string; createdAt: number; updatedAt: number }`; `class ProjectStore` with `constructor(filename: string)` (pass `':memory:'` in tests), `create(document: string, now: number): string`, `load(id: string): StoredProject | null`, `update(id: string, document: string, now: number): boolean` (false when the id is unknown), `close(): void`. Task 4 wires these to routes.
- The store deals in **strings**, not parsed objects: validation is Task 3's job and happens above this layer. Timestamps are injected so tests are deterministic.

- [ ] **Step 1: Write the failing tests**

`server/ids.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { newProjectId } from './ids.ts'

describe('newProjectId', () => {
  it('is url-safe and long enough to be unguessable', () => {
    const id = newProjectId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newProjectId()))
    expect(ids.size).toBe(500)
  })
})
```

`server/db.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ProjectStore } from './db.ts'

const doc = (name: string) => JSON.stringify({ version: 1, name })

let store: ProjectStore

beforeEach(() => {
  store = new ProjectStore(':memory:')
})
afterEach(() => {
  store.close()
})

describe('ProjectStore', () => {
  it('creates a project and reads it back', () => {
    const id = store.create(doc('Cat Chase'), 1000)
    const found = store.load(id)
    expect(found).toMatchObject({ id, document: doc('Cat Chase'), createdAt: 1000, updatedAt: 1000 })
  })

  it('returns null for an unknown id', () => {
    expect(store.load('nope')).toBeNull()
  })

  it('updates a project and moves updatedAt but not createdAt', () => {
    const id = store.create(doc('First'), 1000)
    expect(store.update(id, doc('Second'), 2000)).toBe(true)
    expect(store.load(id)).toMatchObject({
      document: doc('Second'),
      createdAt: 1000,
      updatedAt: 2000,
    })
  })

  it('reports an update to an unknown id instead of creating one', () => {
    expect(store.update('nope', doc('x'), 1000)).toBe(false)
    expect(store.load('nope')).toBeNull()
  })

  it('keeps projects independent', () => {
    const a = store.create(doc('A'), 1)
    const b = store.create(doc('B'), 2)
    expect(a).not.toBe(b)
    store.update(a, doc('A2'), 3)
    expect(store.load(b)?.document).toBe(doc('B'))
  })

  it('stores documents verbatim, including awkward characters', () => {
    const tricky = JSON.stringify({ version: 1, name: 'it\'s "quoted" — ☃', mainScript: 'a\nb' })
    const id = store.create(tricky, 1)
    expect(store.load(id)?.document).toBe(tricky)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/db.test.ts server/ids.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`server/ids.ts`:
```ts
import { randomBytes } from 'node:crypto'

/**
 * A project id is a capability: whoever holds it can read and write that
 * project. 16 random bytes (22 base64url characters) is far past guessing.
 */
export function newProjectId(): string {
  return randomBytes(16).toString('base64url')
}
```

`server/db.ts`:
```ts
import { DatabaseSync } from 'node:sqlite'
import { newProjectId } from './ids.ts'

export interface StoredProject {
  id: string
  document: string
  createdAt: number
  updatedAt: number
}

/**
 * Stores project documents as opaque JSON strings. Validation happens above
 * this layer; the store's only job is durable, verbatim storage.
 */
export class ProjectStore {
  private db: DatabaseSync

  constructor(filename: string) {
    this.db = new DatabaseSync(filename)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        document TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  create(document: string, now: number): string {
    const id = newProjectId()
    this.db
      .prepare('INSERT INTO projects (id, document, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, document, now, now)
    return id
  }

  load(id: string): StoredProject | null {
    const row = this.db
      .prepare('SELECT id, document, created_at, updated_at FROM projects WHERE id = ?')
      .get(id) as
      | { id: string; document: string; created_at: number; updated_at: number }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      document: row.document,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  update(id: string, document: string, now: number): boolean {
    const result = this.db
      .prepare('UPDATE projects SET document = ?, updated_at = ? WHERE id = ?')
      .run(document, now, id)
    return Number(result.changes) > 0
  }

  close(): void {
    this.db.close()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/db.test.ts server/ids.test.ts && npm run typecheck:server`
Expected: PASS. If `node:sqlite` emits an experimental-feature warning, note it in your report — warnings in test output are worth flagging, but do not suppress them by changing the code.

- [ ] **Step 5: Commit**

```bash
git add server/db.ts server/ids.ts server/db.test.ts server/ids.test.ts
git commit -m "feat: SQLite project store with capability ids"
```

---

### Task 3: Project document validation

**Files:**
- Create: `src/shared/projectSchema.ts`, `src/shared/projectSchema.test.ts`

**Interfaces:**
- Consumes: `Project` (type only).
- Produces: `MAX_PROJECT_BYTES = 10 * 1024 * 1024`; `type ValidationResult = { ok: true; project: Project } | { ok: false; error: string }`; `parseProjectDocument(raw: string): ValidationResult` (parses and validates, and enforces the byte cap); `validateProject(value: unknown): ValidationResult` (validates an already-parsed value).
- This module has **no runtime imports** — its only import is `import type { Project } from './project'`, which is erased at runtime. That is what lets the server import it directly under Node's type stripping. Task 4 depends on this property.
- Error messages are readable by a person, since they surface in the IDE: `"That file isn't a game this app can open (it has no version)."`

- [ ] **Step 1: Write the failing test**

`src/shared/projectSchema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseProjectDocument, validateProject, MAX_PROJECT_BYTES } from './projectSchema'
import { addSprite, createEmptyProject, setScript } from './project'

const good = () => {
  let p = createEmptyProject()
  p = addSprite(p, 'Cat', [{ name: 'cat-a', source: 'library:cat-a' }])
  return setScript(p, 'Cat', 'onStart(() => {})')
}

describe('validateProject', () => {
  it('accepts a project the IDE actually produces', () => {
    const result = validateProject(good())
    expect(result.ok).toBe(true)
  })

  it('rejects non-objects', () => {
    expect(validateProject(null).ok).toBe(false)
    expect(validateProject('a string').ok).toBe(false)
    expect(validateProject([]).ok).toBe(false)
  })

  it('rejects an unknown version', () => {
    const result = validateProject({ ...good(), version: 2 })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/version/i)
  })

  it('rejects missing or wrongly-typed top-level fields', () => {
    const { name: _dropped, ...noName } = good()
    expect(validateProject(noName).ok).toBe(false)
    expect(validateProject({ ...good(), mainScript: 42 }).ok).toBe(false)
    expect(validateProject({ ...good(), sprites: 'nope' }).ok).toBe(false)
    expect(validateProject({ ...good(), stage: null }).ok).toBe(false)
  })

  it('rejects a malformed sprite and says which one', () => {
    const project = good()
    const result = validateProject({
      ...project,
      sprites: [{ ...project.sprites[0], x: 'over there' }],
    })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/Cat/)
  })

  it('rejects a sprite whose script is not a string', () => {
    const project = good()
    expect(
      validateProject({ ...project, sprites: [{ ...project.sprites[0], script: null }] }).ok,
    ).toBe(false)
  })

  it('rejects malformed asset refs', () => {
    const project = good()
    expect(
      validateProject({ ...project, sounds: [{ name: 'beep' }] }).ok,
    ).toBe(false)
  })
})

describe('parseProjectDocument', () => {
  it('parses valid json', () => {
    const result = parseProjectDocument(JSON.stringify(good()))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.sprites[0].name).toBe('Cat')
  })

  it('rejects json that will not parse', () => {
    const result = parseProjectDocument('{ not json')
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/could not be read/i)
  })

  it('rejects a document over the size cap before parsing it', () => {
    const huge = 'x'.repeat(MAX_PROJECT_BYTES + 1)
    const result = parseProjectDocument(huge)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toMatch(/too big/i)
  })

  it('measures bytes, not characters', () => {
    // '☃' is three UTF-8 bytes, so a third as many characters still busts the
    // cap — counting characters here would let a document three times the
    // limit through.
    const overByBytes = '☃'.repeat(Math.ceil(MAX_PROJECT_BYTES / 3))
    expect(overByBytes.length).toBeLessThan(MAX_PROJECT_BYTES)
    expect(parseProjectDocument(overByBytes).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/projectSchema.test.ts`
Expected: FAIL — cannot resolve `./projectSchema`.

- [ ] **Step 3: Write the implementation**

`src/shared/projectSchema.ts`:
```ts
import type { Project } from './project'

export const MAX_PROJECT_BYTES = 10 * 1024 * 1024

export type ValidationResult =
  | { ok: true; project: Project }
  | { ok: false; error: string }

const fail = (error: string): ValidationResult => ({ ok: false, error })

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAssetRef(value: unknown): boolean {
  return isPlainObject(value) && typeof value.name === 'string' && typeof value.source === 'string'
}

function spriteError(value: unknown, index: number): string | null {
  if (!isPlainObject(value)) return `Sprite ${index + 1} is not readable.`
  const label = typeof value.name === 'string' ? `"${value.name}"` : `${index + 1}`
  if (typeof value.name !== 'string') return `Sprite ${label} has no name.`
  for (const key of ['x', 'y', 'size', 'direction', 'currentCostume'] as const) {
    if (typeof value[key] !== 'number' || Number.isNaN(value[key])) {
      return `Sprite ${label} has a bad ${key}.`
    }
  }
  if (typeof value.visible !== 'boolean') return `Sprite ${label} has a bad visible flag.`
  if (typeof value.script !== 'string') return `Sprite ${label} has no script.`
  if (!Array.isArray(value.costumes) || !value.costumes.every(isAssetRef)) {
    return `Sprite ${label} has a bad costume.`
  }
  return null
}

/** Validates an already-parsed value against the project shape. */
export function validateProject(value: unknown): ValidationResult {
  if (!isPlainObject(value)) return fail("That isn't a game this app can open.")
  if (value.version !== 1) {
    return fail("That game was made by a different version of this app (bad version).")
  }
  if (typeof value.name !== 'string') return fail('That game has no name.')
  if (typeof value.mainScript !== 'string') return fail('That game has no main script.')

  if (!Array.isArray(value.sprites)) return fail('That game has no sprites list.')
  for (const [index, sprite] of value.sprites.entries()) {
    const error = spriteError(sprite, index)
    if (error) return fail(error)
  }

  const stage = value.stage
  if (!isPlainObject(stage)) return fail('That game has no stage.')
  if (!Array.isArray(stage.backdrops) || !stage.backdrops.every(isAssetRef)) {
    return fail('That game has a bad backdrop.')
  }
  if (typeof stage.currentBackdrop !== 'number') return fail('That game has a bad backdrop choice.')

  if (!Array.isArray(value.sounds) || !value.sounds.every(isAssetRef)) {
    return fail('That game has a bad sound.')
  }

  return { ok: true, project: value as unknown as Project }
}

/** Parses a stored/uploaded document, enforcing the size cap first. */
export function parseProjectDocument(raw: string): ValidationResult {
  if (Buffer.byteLength(raw, 'utf8') > MAX_PROJECT_BYTES) {
    return fail('That game is too big to save. Try using smaller pictures.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('That game could not be read.')
  }
  return validateProject(parsed)
}
```

Note: `Buffer` is available in Node and in Vitest's node environment. The browser never calls `parseProjectDocument` — the client validates through `validateProject` on data it already parsed — so this module stays usable in both places. If the bundler complains about `Buffer` when Task 7 imports this file into the client, replace that one line with `new TextEncoder().encode(raw).length` and note the change in your report.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/projectSchema.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Prove the server can import it**

The server runs under Node's type stripping, which erases `import type` but resolves real imports. Verify this module is importable there:

Run: `node --input-type=module -e "import('./src/shared/projectSchema.ts').then(m => console.log('validate:', m.validateProject({}).ok, 'cap:', m.MAX_PROJECT_BYTES))"`
Expected: prints `validate: false cap: 10485760`. If it instead fails to resolve `./project`, the type-only import was written as a value import — fix it and re-run. Paste the output in your report.

- [ ] **Step 6: Commit**

```bash
git add src/shared/projectSchema.ts src/shared/projectSchema.test.ts
git commit -m "feat: project document validation with a size cap"
```

---

### Task 4: The three project endpoints

**Files:**
- Modify: `server/app.ts`, `server/app.test.ts`
- Create: `server/routes.ts`

**Interfaces:**
- Consumes: `ProjectStore` (Task 2), `parseProjectDocument`/`validateProject` (Task 3).
- Produces: `registerProjectRoutes(app, deps: { store: ProjectStore; now: () => number })`, and `buildApp` grows an options bag: `buildApp(options?: { logger?: boolean; store?: ProjectStore; now?: () => number })` defaulting to a `ProjectStore(process.env.DB_FILE ?? 'projects.db')`. Tests pass an in-memory store and a fixed clock.
- Routes:
  - `POST /api/projects` — body is the project document → `201 { id }`
  - `GET /api/projects/:id` — → `200 <project document>` | `404 { error }`
  - `PUT /api/projects/:id` — body is the project document → `200 { ok: true }` | `404 { error }`
  - Invalid document → `400 { error }`; over the cap → `413 { error }`
- Fastify's default body limit is 1 MB, well under our 10 MB cap, so set `bodyLimit: MAX_PROJECT_BYTES + 1024`. A body larger than *that* is rejected by Fastify before any handler runs, with its own terse error — so also map that error to our wording in an error handler. The result: a kid always sees the same friendly message, and the server still refuses to buffer an unbounded body.

- [ ] **Step 1: Write the failing tests**

Replace `server/app.test.ts` with:
```ts
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

const create = (body: unknown) => app.inject({ method: 'POST', url: '/api/projects', payload: body })

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/app.test.ts`
Expected: FAIL — `buildApp` does not accept a store, and the routes 404.

- [ ] **Step 3: Write the implementation**

`server/routes.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { ProjectStore } from './db.ts'
import {
  MAX_PROJECT_BYTES,
  validateProject,
} from '../src/shared/projectSchema.ts'

export interface RouteDeps {
  store: ProjectStore
  now: () => number
}

/**
 * Checks an incoming body and returns the document to store, or the reply to
 * send instead. Validation happens before anything touches the database.
 */
function check(body: unknown): { document: string } | { status: number; error: string } {
  const result = validateProject(body)
  if (!result.ok) return { status: 400, error: result.error }
  const document = JSON.stringify(result.project)
  if (Buffer.byteLength(document, 'utf8') > MAX_PROJECT_BYTES) {
    return { status: 413, error: 'That game is too big to save. Try using smaller pictures.' }
  }
  return { document }
}

export function registerProjectRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/projects', async (request, reply) => {
    const checked = check(request.body)
    if ('error' in checked) return reply.code(checked.status).send({ error: checked.error })
    const id = deps.store.create(checked.document, deps.now())
    return reply.code(201).send({ id })
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const found = deps.store.load(request.params.id)
    if (!found) {
      return reply.code(404).send({ error: "We couldn't find a game with that link." })
    }
    return reply.type('application/json').send(found.document)
  })

  app.put<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const checked = check(request.body)
    if ('error' in checked) return reply.code(checked.status).send({ error: checked.error })
    const saved = deps.store.update(request.params.id, checked.document, deps.now())
    if (!saved) {
      return reply.code(404).send({ error: "We couldn't find a game with that link." })
    }
    return reply.send({ ok: true })
  })
}
```

Rewrite `server/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import { ProjectStore } from './db.ts'
import { registerProjectRoutes } from './routes.ts'
import { MAX_PROJECT_BYTES } from '../src/shared/projectSchema.ts'

export interface AppOptions {
  logger?: boolean
  store?: ProjectStore
  now?: () => number
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    // Let oversize bodies reach our own check so kids get the friendly message
    // instead of Fastify's default 413.
    bodyLimit: MAX_PROJECT_BYTES + 1024,
  })

  const store = options.store ?? new ProjectStore(process.env.DB_FILE ?? 'projects.db')

  // A body past `bodyLimit` never reaches a handler, so translate Fastify's
  // own error into the same message our size check produces.
  app.setErrorHandler(async (error, _request, reply) => {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.statusCode === 413) {
      return reply
        .code(413)
        .send({ error: 'That game is too big to save. Try using smaller pictures.' })
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message })
    }
    app.log.error(error)
    return reply.code(500).send({ error: 'Something went wrong on our side.' })
  })

  registerProjectRoutes(app, { store, now: options.now ?? Date.now })

  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send({ error: 'That page was not found.' }),
  )

  return app
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/app.test.ts && npm run typecheck:server && npm test`
Expected: PASS. The 11 MB payload is caught by Fastify's `bodyLimit` rather than by our own check — the error handler is what turns it into the friendly message, so if that test fails, fix the handler rather than raising the limit. Confirm in your report which path produced the 413.

- [ ] **Step 5: Commit**

```bash
git add server/ && git commit -m "feat: create, load, and update project endpoints"
```

---

### Task 5: Serve the built app with the headers the stage needs

**Files:**
- Modify: `server/app.ts`, `server/app.test.ts`
- Create: `server/static.ts`

**Interfaces:**
- Consumes: `@fastify/static`.
- Produces: `registerStatic(app, options: { root: string })` — serves the built client and applies the two required headers. `buildApp` gains `staticRoot?: string | null` (default `dist/`; pass `null` in unit tests that only care about the API).
- Behavior:
  - `runtime.html` → `Access-Control-Allow-Origin: *` **and** `Content-Security-Policy: frame-ancestors 'self'`
  - anything under `/assets/` → `Access-Control-Allow-Origin: *` (the iframe's bundle lives here)
  - `/p/<id>` and any other non-API, non-file path → serve `index.html` so the IDE can route
  - unknown `/api/*` → JSON 404 (unchanged)

- [ ] **Step 1: Write the failing tests**

Append to `server/app.test.ts`:
```ts
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fakeDist(): string {
  const root = mkdtempSync(join(tmpdir(), 'dist-'))
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>IDE</title>')
  writeFileSync(join(root, 'runtime.html'), '<!doctype html><title>Stage</title>')
  writeFileSync(join(root, 'assets', 'runtime-abc.js'), 'console.log(1)')
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/app.test.ts`
Expected: FAIL — `staticRoot` is not an option and the routes 404.

- [ ] **Step 3: Write the implementation**

`server/static.ts`:
```ts
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/**
 * Serves the built client.
 *
 * Two headers are load-bearing, not hygiene:
 *  - The stage runs in <iframe sandbox="allow-scripts">, which gives it an
 *    opaque origin. Module scripts are always fetched in CORS mode, so without
 *    Access-Control-Allow-Origin the iframe cannot load its own bundle and the
 *    stage silently stays blank.
 *  - frame-ancestors stops another site from framing runtime.html to run code
 *    at this origin.
 */
export function registerStatic(app: FastifyInstance, options: { root: string }): void {
  app.register(fastifyStatic, {
    root: options.root,
    setHeaders(res, path) {
      if (path.endsWith('runtime.html')) {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
      } else if (path.includes('/assets/')) {
        res.setHeader('Access-Control-Allow-Origin', '*')
      }
    },
  })

  // Anything that is not an API route and not a real file is a client route
  // (e.g. /p/<id>): hand back the IDE and let it decide what to show.
  // `reply.sendFile` comes from @fastify/static, which is wrapped in
  // fastify-plugin, so the decorator is available on this instance. If it
  // turns out not to be, read index.html once at startup and send the string.
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'That page was not found.' })
    }
    return reply.sendFile('index.html')
  })
}
```

Update `server/app.ts`: add `staticRoot?: string | null` to `AppOptions`, and replace the `setNotFoundHandler` call with:
```ts
  const staticRoot = options.staticRoot === undefined ? defaultDist() : options.staticRoot
  if (staticRoot) {
    registerStatic(app, { root: staticRoot })
  } else {
    app.setNotFoundHandler(async (request, reply) =>
      reply.code(404).send({ error: 'That page was not found.' }),
    )
  }
```
with this helper and imports at the top:
```ts
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { registerStatic } from './static.ts'

const defaultDist = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
```

The existing API-only tests construct `buildApp({ store, now })` without `staticRoot`, which would now serve `dist/`. Pass `staticRoot: null` in those `beforeEach` calls so they stay focused on the API.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/app.test.ts && npm run typecheck:server && npm test`
Expected: PASS.

- [ ] **Step 5: Verify against the real build**

Run: `npm run build && npm run server` in one shell; in another:
```bash
curl -sI localhost:8080/runtime.html | grep -iE 'access-control-allow-origin|content-security-policy'
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/p/abcdefghijklmnopqrstuv
```
Expected: both headers present; the project link returns 200. Paste the output in your report, then stop the server.

- [ ] **Step 6: Commit**

```bash
git add server/ && git commit -m "feat: serve the built app with the headers the sandboxed stage requires"
```

---

### Task 6: Client API and the recent-games list

**Files:**
- Create: `src/ide/api.ts`, `src/ide/api.test.ts`, `src/ide/recentGames.ts`, `src/ide/recentGames.test.ts`

**Interfaces:**
- Consumes: `Project`, `validateProject`.
- Produces:
  - `class ApiError extends Error { status: number }`; `createProject(project, fetchFn?): Promise<string>`; `loadProject(id, fetchFn?): Promise<Project>`; `saveProject(id, project, fetchFn?): Promise<void>`. Each throws `ApiError` carrying the server's readable message; a network failure throws one with status `0` and a friendly message.
  - `loadProject` validates what comes back, so a corrupted document fails at the door rather than halfway through rendering.
  - `interface RecentGame { id: string; name: string; savedAt: number }`; `readRecent(storage): RecentGame[]`; `rememberGame(storage, game): void` (newest first, de-duplicated by id, capped at `MAX_RECENT_GAMES = 12`); `forgetGame(storage, id): void`. All take a `Storage`-shaped object so they test without a DOM.
- `projectUrl(id)` returns `/p/${id}` — one place that knows the link shape.

- [ ] **Step 1: Write the failing tests**

`src/ide/api.test.ts`:
```ts
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
```

`src/ide/recentGames.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MAX_RECENT_GAMES, forgetGame, readRecent, rememberGame } from './recentGames'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

let storage: Storage
beforeEach(() => {
  storage = fakeStorage()
})

describe('recent games', () => {
  it('starts empty and survives junk in storage', () => {
    expect(readRecent(storage)).toEqual([])
    storage.setItem('game-grand:recent', 'not json')
    expect(readRecent(storage)).toEqual([])
  })

  it('remembers newest first', () => {
    rememberGame(storage, { id: 'a', name: 'A', savedAt: 1 })
    rememberGame(storage, { id: 'b', name: 'B', savedAt: 2 })
    expect(readRecent(storage).map(g => g.id)).toEqual(['b', 'a'])
  })

  it('moves a re-saved game to the front instead of duplicating it', () => {
    rememberGame(storage, { id: 'a', name: 'A', savedAt: 1 })
    rememberGame(storage, { id: 'b', name: 'B', savedAt: 2 })
    rememberGame(storage, { id: 'a', name: 'A renamed', savedAt: 3 })
    const recent = readRecent(storage)
    expect(recent.map(g => g.id)).toEqual(['a', 'b'])
    expect(recent[0].name).toBe('A renamed')
  })

  it('caps the list', () => {
    for (let i = 0; i < MAX_RECENT_GAMES + 5; i++) {
      rememberGame(storage, { id: `g${i}`, name: `G${i}`, savedAt: i })
    }
    const recent = readRecent(storage)
    expect(recent).toHaveLength(MAX_RECENT_GAMES)
    expect(recent[0].id).toBe(`g${MAX_RECENT_GAMES + 4}`)
  })

  it('forgets one game', () => {
    rememberGame(storage, { id: 'a', name: 'A', savedAt: 1 })
    rememberGame(storage, { id: 'b', name: 'B', savedAt: 2 })
    forgetGame(storage, 'a')
    expect(readRecent(storage).map(g => g.id)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ide/api.test.ts src/ide/recentGames.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`src/ide/api.ts`:
```ts
import type { Project } from '../shared/project'
import { validateProject } from '../shared/projectSchema'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const projectUrl = (id: string): string => `/p/${id}`

async function request(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchFn(url, init)
  } catch {
    throw new ApiError("We couldn't reach the server. Are you online?", 0)
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    const message =
      typeof (body as { error?: unknown })?.error === 'string'
        ? (body as { error: string }).error
        : 'Something went wrong saving your game.'
    throw new ApiError(message, response.status)
  }
  return body
}

const jsonInit = (method: string, project: Project): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(project),
})

export async function createProject(
  project: Project,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const body = await request('/api/projects', jsonInit('POST', project), fetchFn)
  const id = (body as { id?: unknown })?.id
  if (typeof id !== 'string') throw new ApiError('The server did not return a game link.', 0)
  return id
}

export async function loadProject(id: string, fetchFn: typeof fetch = fetch): Promise<Project> {
  const body = await request(`/api/projects/${id}`, { method: 'GET' }, fetchFn)
  const result = validateProject(body)
  if (!result.ok) throw new ApiError(result.error, 0)
  return result.project
}

export async function saveProject(
  id: string,
  project: Project,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await request(`/api/projects/${id}`, jsonInit('PUT', project), fetchFn)
}
```

`src/ide/recentGames.ts`:
```ts
export interface RecentGame {
  id: string
  name: string
  savedAt: number
}

export const MAX_RECENT_GAMES = 12
const KEY = 'game-grand:recent'

/**
 * A local convenience list only — the link is the real key to a game. Anything
 * unreadable in storage is treated as an empty list rather than an error: a
 * corrupt list must never stop a kid from opening their game.
 */
export function readRecent(storage: Storage): RecentGame[] {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (g): g is RecentGame =>
        typeof g?.id === 'string' && typeof g?.name === 'string' && typeof g?.savedAt === 'number',
    )
  } catch {
    return []
  }
}

export function rememberGame(storage: Storage, game: RecentGame): void {
  const next = [game, ...readRecent(storage).filter(g => g.id !== game.id)].slice(
    0,
    MAX_RECENT_GAMES,
  )
  storage.setItem(KEY, JSON.stringify(next))
}

export function forgetGame(storage: Storage, id: string): void {
  storage.setItem(KEY, JSON.stringify(readRecent(storage).filter(g => g.id !== id)))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ide/api.test.ts src/ide/recentGames.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ide/api.ts src/ide/api.test.ts src/ide/recentGames.ts src/ide/recentGames.test.ts
git commit -m "feat: client api and recent-games list"
```

---

### Task 7: Save and Load in the IDE

**Files:**
- Modify: `src/ide/store.ts`, `src/ide/store.test.ts`, `src/ide/components/App.tsx`, `src/ide/styles.css`
- Create: `src/ide/components/SaveBar.tsx`, `src/ide/components/LoadDialog.tsx`

**Interfaces:**
- Consumes: Task 6's api and recent-games modules.
- Produces on the store: `IdeState` gains `projectId: string | null` and `save: { status: 'idle' | 'saving' | 'saved' | 'error'; message: string | null }`; actions `rename-project`, `saving`, `saved` (`{ id }`), `save-failed` (`{ message }`), `project-loaded` (`{ id, project }`). `initialState` gains an optional second argument for a starting `projectId`.
- `App` behavior:
  - On mount, if `location.pathname` matches `/p/<id>`, load that project; while loading show a plain "Opening your game…" state; on failure show the message with a "Start a new game instead" button.
  - Save: with no `projectId`, create then `history.replaceState` to `/p/<id>`; with one, update. Either way remember the game locally and set the save status.
  - After the first save, show the link with a "Copy link" button and the warning that the link is the only way back.
  - Load dialog: recent games (open/forget) and a paste-a-link field.
- Renaming the project must not lose unsaved work: the reducer only touches `project.name`.

- [ ] **Step 1: Write the failing store tests**

Append to `src/ide/store.test.ts`:
```ts
describe('saving', () => {
  it('starts with no project id and an idle save state', () => {
    const s = initialState(createEmptyProject())
    expect(s.projectId).toBeNull()
    expect(s.save).toEqual({ status: 'idle', message: null })
  })

  it('accepts a starting project id', () => {
    expect(initialState(createEmptyProject(), 'abc123').projectId).toBe('abc123')
  })

  it('renames the project without touching anything else', () => {
    const before = withCat()
    const after = reducer(before, { type: 'rename-project', name: 'Cat Chase' })
    expect(after.project.name).toBe('Cat Chase')
    expect(after.project.sprites).toEqual(before.project.sprites)
  })

  it('moves through saving to saved and records the id', () => {
    let s = reducer(withCat(), { type: 'saving' })
    expect(s.save.status).toBe('saving')
    s = reducer(s, { type: 'saved', id: 'abc123' })
    expect(s.projectId).toBe('abc123')
    expect(s.save).toEqual({ status: 'saved', message: null })
  })

  it('keeps the id when a later save fails, and surfaces why', () => {
    let s = reducer(withCat(), { type: 'saved', id: 'abc123' })
    s = reducer(s, { type: 'save-failed', message: 'That game is too big to save.' })
    expect(s.projectId).toBe('abc123')
    expect(s.save).toEqual({ status: 'error', message: 'That game is too big to save.' })
  })

  it('replaces the whole project when one is loaded, and selects main', () => {
    const loaded = addSprite(createEmptyProject(), 'Bat', [costume])
    let s = reducer(withCat(), { type: 'select-tab', tab: 'Cat' })
    s = reducer(s, { type: 'project-loaded', id: 'xyz', project: loaded })
    expect(s.projectId).toBe('xyz')
    expect(s.project.sprites.map(x => x.name)).toEqual(['Bat'])
    expect(s.selectedTab).toBe('main')
    expect(s.save).toEqual({ status: 'saved', message: null })
  })

  it('an edit after saving returns the state to idle so Save is offered again', () => {
    let s = reducer(withCat(), { type: 'saved', id: 'abc123' })
    s = reducer(s, { type: 'set-script', tab: 'main', script: 'vars.score = 0' })
    expect(s.save.status).toBe('idle')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ide/store.test.ts`
Expected: FAIL — `projectId`/`save` are missing and the new actions are unhandled.

- [ ] **Step 3: Extend the store**

In `src/ide/store.ts`:
- Add to `IdeState`: `projectId: string | null` and `save: { status: 'idle' | 'saving' | 'saved' | 'error'; message: string | null }`.
- `initialState(project: Project, projectId: string | null = null)` sets `projectId` and `save: { status: 'idle', message: null }`.
- Add the actions to `IdeAction`:
```ts
  | { type: 'rename-project'; name: string }
  | { type: 'saving' }
  | { type: 'saved'; id: string }
  | { type: 'save-failed'; message: string }
  | { type: 'project-loaded'; id: string; project: Project }
```
- Add the cases:
```ts
    case 'rename-project':
      return { ...state, project: { ...state.project, name: action.name } }

    case 'saving':
      return { ...state, save: { status: 'saving', message: null } }

    case 'saved':
      return { ...state, projectId: action.id, save: { status: 'saved', message: null } }

    case 'save-failed':
      return { ...state, save: { status: 'error', message: action.message } }

    case 'project-loaded':
      return {
        ...state,
        project: action.project,
        projectId: action.id,
        selectedTab: 'main',
        save: { status: 'saved', message: null },
        console: [],
      }
```
- Any action that edits the project must drop a `saved` status back to `idle`, so the UI stops claiming the work is safe. Add this at the end of `reducer`, wrapping the existing switch: extract the current body into `applyAction(state, action)`, then:
```ts
const EDITING_ACTIONS = new Set([
  'add-sprite', 'add-backdrop', 'add-sound', 'delete-sprite', 'rename-sprite',
  'set-script', 'rename-project',
])

export function reducer(state: IdeState, action: IdeAction): IdeState {
  const next = applyAction(state, action)
  if (next.save.status === 'saved' && EDITING_ACTIONS.has(action.type)) {
    return { ...next, save: { status: 'idle', message: null } }
  }
  return next
}
```

- [ ] **Step 4: Run store tests to verify they pass**

Run: `npx vitest run src/ide/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the UI**

`src/ide/components/SaveBar.tsx`:
```tsx
import { useState } from 'react'
import { projectUrl } from '../api'
import type { IdeState } from '../store'

interface Props {
  state: IdeState
  onRename: (name: string) => void
  onSave: () => void
  onOpenLoad: () => void
}

export function SaveBar({ state, onRename, onSave, onOpenLoad }: Props) {
  const [copied, setCopied] = useState(false)
  const link = state.projectId ? `${window.location.origin}${projectUrl(state.projectId)}` : null

  const status =
    state.save.status === 'saving' ? 'Saving…'
    : state.save.status === 'saved' ? 'Saved'
    : state.save.status === 'error' ? state.save.message
    : ''

  return (
    <div className="savebar">
      <input
        aria-label="Game name"
        value={state.project.name}
        onChange={e => onRename(e.target.value)}
      />
      <button className="primary" onClick={onSave} disabled={state.save.status === 'saving'}>
        Save
      </button>
      <button onClick={onOpenLoad}>Load</button>
      <span className={state.save.status === 'error' ? 'save-error' : 'save-status'}>{status}</span>
      {link && (
        <>
          <input aria-label="Game link" className="link" readOnly value={link} />
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(link)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </>
      )}
    </div>
  )
}
```

`src/ide/components/LoadDialog.tsx`:
```tsx
import { useState } from 'react'
import type { RecentGame } from '../recentGames'

interface Props {
  recent: RecentGame[]
  onOpen: (id: string) => void
  onForget: (id: string) => void
  onClose: () => void
}

/** Pulls the id out of a full link or accepts a bare id. */
export function idFromLink(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const match = trimmed.match(/\/p\/([A-Za-z0-9_-]{22})/)
  if (match) return match[1]
  return /^[A-Za-z0-9_-]{22}$/.test(trimmed) ? trimmed : null
}

export function LoadDialog({ recent, onOpen, onForget, onClose }: Props) {
  const [link, setLink] = useState('')
  const id = idFromLink(link)

  return (
    <div className="drawer load-dialog">
      <div className="toolbar">
        <h1>Open a game</h1>
        <button onClick={onClose}>Close</button>
      </div>

      <h3>Paste a game link</h3>
      <input aria-label="Game link to open" value={link} onChange={e => setLink(e.target.value)} />
      <button disabled={!id} onClick={() => id && onOpen(id)}>Open</button>
      {link !== '' && !id && <p className="empty-note">That doesn’t look like a game link.</p>}

      <h3>Games on this device</h3>
      {recent.length === 0 && <p className="empty-note">Nothing saved here yet.</p>}
      {recent.map(game => (
        <div className="library-entry" key={game.id}>
          <p>{game.name}</p>
          <button onClick={() => onOpen(game.id)}>Open</button>
          <button onClick={() => onForget(game.id)}>Forget</button>
        </div>
      ))}
    </div>
  )
}
```

Add to `src/ide/styles.css`:
```css
.savebar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.savebar input { font: inherit; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; }
.savebar input.link { flex: 1; min-width: 120px; color: #4a5160; background: var(--bg); }
.save-status { font-size: 12px; color: #4a7a4a; }
.save-error { font-size: 12px; color: #b3261e; }
.load-dialog h3 { margin-top: 14px; }
```

`src/ide/components/App.tsx` changes:
- Import `createProject, loadProject, saveProject, ApiError, projectUrl` from `../api`, `readRecent, rememberGame, forgetGame` from `../recentGames`, and the two new components.
- Derive the starting id once: `const startingId = /^\/p\/([A-Za-z0-9_-]{22})$/.exec(window.location.pathname)?.[1] ?? null`, and pass it to `useReducer(reducer, initialState(createEmptyProject(), startingId))`.
- Add `const [opening, setOpening] = useState(startingId !== null)`, `const [loadOpen, setLoadOpen] = useState(false)`, `const [recent, setRecent] = useState(() => readRecent(window.localStorage))`.
- On mount, when `startingId` is set, `loadProject(startingId)` → dispatch `project-loaded`; on `ApiError` dispatch an `issue` with the message and leave `opening` false with an empty project.
- `handleSave`:
```tsx
  const handleSave = async () => {
    dispatch({ type: 'saving' })
    try {
      const id = state.projectId
        ? (await saveProject(state.projectId, state.project), state.projectId)
        : await createProject(state.project)
      dispatch({ type: 'saved', id })
      if (!state.projectId) window.history.replaceState(null, '', projectUrl(id))
      rememberGame(window.localStorage, {
        id,
        name: state.project.name,
        savedAt: Date.now(),
      })
      setRecent(readRecent(window.localStorage))
    } catch (err) {
      dispatch({
        type: 'save-failed',
        message: err instanceof ApiError ? err.message : 'Something went wrong saving your game.',
      })
    }
  }
```
- `handleOpen(id)`: load, dispatch `project-loaded`, `history.pushState` to `projectUrl(id)`, close the dialog; on error dispatch `save-failed` with the message so it shows in the bar.
- Render `<SaveBar …>` above the existing toolbar in the left panel, and render `<LoadDialog …>` in place of the sprite list when `loadOpen` (the same slot the library dialog uses).

- [ ] **Step 6: Verify**

Run: `npm test && npm run build`
Expected: PASS. Then `npm run server`, open `http://localhost:8080`, save a game, copy the link, open it in a new tab, and confirm the game comes back. Report what you observed.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: save and load games by private link"
```

---

### Task 8: End-to-end save/load against the real server

**Files:**
- Create: `e2e/save-load.spec.ts`
- Modify: `playwright.config.ts`, `package.json`, `Makefile`, `docs/TODO.md`, `.gitignore`

**Interfaces:**
- Produces: an `E2E_SERVER=1` mode that builds the client and runs the Fastify server (on port 5176, with `DB_FILE` pointed at a temp file) instead of Vite, plus `npm run test:e2e:server` and `make test-e2e-server`.
- The existing 22 tests must pass in this mode too — it is the first time they run against the real server, which is exactly the configuration users get.

- [ ] **Step 1: Extend the Playwright config**

In `playwright.config.ts`, add a third mode alongside `E2E_PREVIEW`:
```ts
const SERVER = !!process.env.E2E_SERVER
const PREVIEW = !!process.env.E2E_PREVIEW
const PORT = SERVER ? 5176 : PREVIEW ? 5175 : 5174
```
and in `webServer.command`:
```ts
    command: SERVER
      ? `npm run build && DB_FILE=.e2e-projects.db PORT=${PORT} npm run server`
      : PREVIEW
        ? `npm run build && npm run preview -- --port ${PORT} --strictPort`
        : `npm run dev -- --port ${PORT} --strictPort`,
```
Add `.e2e-projects.db` to `.gitignore`. Add to `package.json`: `"test:e2e:server": "E2E_SERVER=1 playwright test"`. Add a `test-e2e-server` target to the `Makefile` mirroring `test-e2e-prod`, and add it to `test-all` and `.PHONY`.

- [ ] **Step 2: Write the failing test**

`e2e/save-load.spec.ts`:
```ts
import { test, expect } from '@playwright/test'
import {
  addSpriteFromLibrary, consoleLines, run, setEditorContent, waitForLibrary,
} from './helpers'

test.skip(!process.env.E2E_SERVER, 'Saving needs the real server (run with E2E_SERVER=1)')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForLibrary(page)
})

test('saves a game and reopens it from its link', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(page, 'onStart(() => console.log("saved cat ran"))')
  await page.getByLabel('Game name').fill('Cat Chase')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.locator('.save-status')).toHaveText('Saved')
  await expect(page).toHaveURL(/\/p\/[A-Za-z0-9_-]{22}$/)
  const link = page.url()

  // A different browser context — proves the link, not local storage, carries it.
  const fresh = await page.context().browser()!.newContext()
  const other = await fresh.newPage()
  await other.goto(link)
  await waitForLibrary(other)

  await expect(other.locator('.sprite-row')).toContainText('Cat')
  await expect(other.getByLabel('Game name')).toHaveValue('Cat Chase')
  await other.getByRole('button', { name: '▶ Run' }).click()
  await expect(other.locator('.console > div')).toContainText(['saved cat ran'])
  await fresh.close()
})

test('saving again updates the same game rather than making a new one', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')
  const firstUrl = page.url()

  await setEditorContent(page, 'onStart(() => console.log("second version"))')
  await expect(page.locator('.save-status')).toHaveText('')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')
  expect(page.url()).toBe(firstUrl)

  await page.reload()
  await waitForLibrary(page)
  await run(page)
  await expect(consoleLines(page)).toContainText(['second version'])
})

test('a saved game appears in this device’s list and reopens from it', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await page.getByLabel('Game name').fill('Listed Game')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')

  await page.goto('/')
  await waitForLibrary(page)
  await page.getByRole('button', { name: 'Load' }).click()
  const entry = page.locator('.load-dialog .library-entry').filter({ hasText: 'Listed Game' })
  await entry.getByRole('button', { name: 'Open' }).click()

  await expect(page.locator('.sprite-row')).toContainText('Cat')
  await expect(page).toHaveURL(/\/p\/[A-Za-z0-9_-]{22}$/)
})

test('opening an unknown link explains itself instead of hanging', async ({ page }) => {
  await page.goto('/p/aaaaaaaaaaaaaaaaaaaaaa')
  await expect(page.locator('.console .issue, .save-error')).toContainText(/couldn't find/i)
})

test('pasting a link into the Load dialog opens that game', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await page.getByLabel('Game name').fill('Pasted Game')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')
  const link = page.url()

  const fresh = await page.context().browser()!.newContext()
  const other = await fresh.newPage()
  await other.goto('/')
  await waitForLibrary(other)
  await other.getByRole('button', { name: 'Load' }).click()
  await other.getByLabel('Game link to open').fill(link)
  await other.getByRole('button', { name: 'Open' }).click()
  await expect(other.getByLabel('Game name')).toHaveValue('Pasted Game')
  await fresh.close()
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `E2E_SERVER=1 npx playwright test e2e/save-load.spec.ts`
Expected: FAIL for real reasons (missing UI or routes), not because the mode is misconfigured. If the whole file skips, the `E2E_SERVER` wiring in Step 1 is wrong — fix that first.

- [ ] **Step 4: Make it pass**

Fix whatever the tests expose in Task 7's UI. Do not weaken an assertion to make it pass; if you believe an assertion is wrong, say so in your report with the evidence.

- [ ] **Step 5: Run everything**

Run, in order:
```bash
npm test
npm run build
npx playwright test
E2E_PREVIEW=1 npx playwright test
E2E_SERVER=1 npx playwright test
```
Expected: all green, including the pre-existing 22 tests in server mode. Report each count.

- [ ] **Step 6: Update the docs**

In `docs/TODO.md`, tick off the two Plan 3 hard requirements (they are now implemented and tested in `server/app.test.ts`), and move anything this plan did not do into the deferred list. In the design spec's testing section, add the server and its e2e mode.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "test: end-to-end save and load against the real server"
```

---

## Done criteria for Plan 3

- `npm test` passes, covering: id generation, the SQLite store, project validation and the size cap, all three endpoints (including 400/404/413), static serving with both required headers and the SPA fallback, the client api wrapper, the recent-games list, and the store's save/load actions.
- `npm run build` typechecks client and server and builds.
- Playwright passes in all three modes: dev, preview, and server.
- `make server` serves a working app on port 8080: a game can be saved, its link opened in a different browser profile, and the game runs.
- No endpoint lists or enumerates projects; ids never appear in logs.
- `src/runtime/**` and `src/runtime-host/**` are unchanged.

## Not in this plan

Accounts, sharing UI beyond the link, export/import to a file, and the costume editor stay deferred — see `docs/TODO.md`. The save format is unchanged, so accounts can layer on later by adding an owner column rather than migrating documents.
