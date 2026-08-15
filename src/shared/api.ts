// Explicit .ts extensions, unlike the rest of src/. This module is imported by
// server/, which is typechecked under NodeNext and requires them; the client's
// bundler resolution accepts them given allowImportingTsExtensions. Any shared
// module the server imports has to follow the same rule.
import { MAX_PROJECT_BYTES, validateProject } from './projectSchema.ts'
import type { ProjectStore } from './projectStore.ts'

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

const notFound = (): ApiResponse => ({
  status: 404,
  body: { error: "We couldn't find a game with that link." },
})

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
 * stands between a browser and the database exists exactly once and cannot
 * drift between the two deployments.
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
    if (!found) return notFound()
    // The body is attacker-authored (a sprite script is an arbitrary string
    // someone typed) and this is a plain, navigable URL. `nosniff` stops a
    // browser that ignores the declared JSON type from guessing its way into
    // treating the response as HTML and running it.
    //
    // `body` here is the stored JSON string, already serialized. Adapters must
    // send it verbatim; re-encoding would double-encode it.
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
    return saved ? { status: 200, body: { ok: true } } : notFound()
  }

  return null
}
