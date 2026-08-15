import { handleApiRequest } from '../src/shared/api.ts'
import { D1ProjectStore } from './d1Store.ts'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
}

/**
 * Reads a JSON body without letting a malformed one throw past us — a kid on
 * a flaky connection should get the friendly 400 that validation produces,
 * not a 500.
 */
async function readBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return null
  try {
    return await request.json()
  } catch {
    return null
  }
}

/**
 * The Cloudflare half of the API. Everything it decides — validation, the size
 * cap, the kid-facing messages — comes from `src/shared/api.ts`, the same
 * module the Fastify server adapts, so the two deployments cannot answer the
 * same request differently.
 *
 * Nothing here logs a URL, a path, or an id. A project id is a capability:
 * whoever reads it in a log line holds edit rights to that game. Keep it that
 * way — that is why there is no console.log in this file at all.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const store = new D1ProjectStore(env.DB)

    const result = await handleApiRequest(
      { method: request.method, path: url.pathname, body: await readBody(request) },
      {
        store,
        now: () => Date.now(),
        // D1's free tier is 5 GB. At the 10 MB per-project cap that is ~500
        // worst-case projects, but real ones are far smaller, so 50k rows is a
        // deliberately conservative ceiling that still refuses a runaway loop
        // long before storage is actually exhausted. Only consulted on create.
        capacity: { used: () => store.countProjects(), limit: 50_000 },
      },
    )

    // Not an API route: hand it to the assets binding, which applies _headers
    // and the single-page-application fallback that serves the IDE for /p/<id>.
    if (!result) {
      const asset = await env.ASSETS.fetch(request)

      // That fallback is right for /p/<id> and wrong for /assets/. A missing
      // bundle would come back as index.html with status 200, which the
      // browser then feeds to <script type="module"> — turning a broken
      // deploy into a silently blank stage instead of an error. The Fastify
      // server refuses the same thing (server/static.ts, and there is a test
      // for it), so the two deployments must not disagree here.
      if (
        url.pathname.startsWith('/assets/') &&
        asset.headers.get('content-type')?.includes('text/html')
      ) {
        return new Response('Not found', { status: 404 })
      }

      return asset
    }

    const headers = new Headers(result.headers)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

    // A GET of a saved project returns the stored JSON string verbatim;
    // everything else is an object this layer serializes. Re-encoding the
    // stored string would double-encode it and the IDE would fail to parse it.
    const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body)

    return new Response(body, { status: result.status, headers })
  },
}
