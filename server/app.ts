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
