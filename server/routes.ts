import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { handleApiRequest, type ApiDeps } from '../src/shared/api.ts'

export type RouteDeps = ApiDeps

/**
 * The Fastify half of the API. All of the behaviour — validation, the size
 * cap, the kid-facing messages, the nosniff header — lives in
 * `src/shared/api.ts`, which the Cloudflare Worker calls too. This file only
 * translates Fastify's request into a plain one and its response back out,
 * so the two deployments cannot answer the same request differently.
 */
export function registerProjectRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const handle = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    // Fastify's `url` carries the query string; the shared router matches on
    // the path alone.
    const path = request.url.split('?')[0]
    const result = await handleApiRequest(
      { method: request.method, path, body: request.body },
      deps,
    )

    // Only reachable if Fastify routed something the shared handler does not
    // recognise, which would mean the two disagree about what an API route is.
    if (!result) {
      return reply.code(404).send({ error: "We couldn't find a game with that link." })
    }

    for (const [name, value] of Object.entries(result.headers ?? {})) {
      reply.header(name, value)
    }
    return reply.code(result.status).send(result.body)
  }

  app.post('/api/projects', handle)
  app.get('/api/projects/:id', handle)
  app.put('/api/projects/:id', handle)
}
