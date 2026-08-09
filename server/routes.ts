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
    // The body is attacker-authored (a sprite script is an arbitrary string
    // someone typed) and this is a plain, navigable URL. `nosniff` stops a
    // browser that ignores the declared JSON type from guessing its way into
    // treating the response as HTML and running it.
    return reply
      .header('X-Content-Type-Options', 'nosniff')
      .type('application/json')
      .send(found.document)
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
