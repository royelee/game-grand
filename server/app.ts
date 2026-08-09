import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
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
  app.setErrorHandler(async (error: FastifyError, _request, reply) => {
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

  app.get('/api/health', async () => ({ ok: true }))

  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send({ error: 'That page was not found.' }),
  )

  return app
}
