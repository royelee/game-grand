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
  /**
   * Storage circuit breaker. POST /api/projects is unauthenticated and
   * unmetered, so a loop of creates fills storage and takes everyone's saves
   * down. A per-minute rate limit never notices a slow fill; this does.
   *
   * Only creates are refused. A full disk must never stop a kid saving work
   * they already have a link to.
   */
  capacity?: { used(): Promise<number>; limit: number }
  /**
   * Per-client limit on creating games. Returns false when this caller has
   * had enough for now.
   *
   * Separate from `capacity`, because they catch different failures: this
   * stops one machine hammering the endpoint, while capacity catches a slow
   * fill from many machines that no per-minute limit would ever notice.
   *
   * The caller decides what "per client" means — this layer never sees an IP
   * address, so it stays free of anything Cloudflare-specific.
   */
  rateLimit?: () => Promise<boolean>
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
    // Checked before capacity, which costs a COUNT query: under a flood the
    // cheap check should be the one that runs.
    if (deps.rateLimit && !(await deps.rateLimit())) {
      return {
        status: 429,
        body: {
          error: "You're making new games very quickly! Wait a moment, then try again.",
        },
      }
    }
    if (deps.capacity && (await deps.capacity.used()) >= deps.capacity.limit) {
      return {
        status: 503,
        body: {
          error:
            "We're keeping too many games right now, so we can't save a new one. Please try again later.",
        },
      }
    }
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
