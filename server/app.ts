import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { ProjectStore } from './db.ts'
import { registerProjectRoutes } from './routes.ts'
import { registerStatic } from './static.ts'
import { MAX_PROJECT_BYTES } from '../src/shared/projectSchema.ts'

const defaultDist = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

export interface AppOptions {
  // `{ stream }` is a test-only escape hatch: it takes the exact same
  // serializer/config path as `true`, but lets a test capture the real pino
  // output instead of writing it to stdout, so the redaction can be verified
  // against what Fastify actually logs rather than trusted on faith.
  logger?: boolean | { stream: NodeJS.WritableStream }
  store?: ProjectStore
  now?: () => number
  // The built client to serve. Defaults to `dist/` next to the server.
  // Tests that only care about the API pass `null` so a stray `dist/` on
  // disk can't make them serve static files instead of JSON.
  staticRoot?: string | null
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger
      ? {
          serializers: {
            // A project id in a URL is a capability — logging one hands out
            // edit rights to that game. Log the shape of the request, never
            // the id itself.
            req: (request: { method: string; url: string }) => ({
              method: request.method,
              url: request.url.replace(/\/api\/projects\/[^/?]+/, '/api/projects/[id]'),
            }),
          },
          ...(typeof options.logger === 'object' ? { stream: options.logger.stream } : {}),
        }
      : false,
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

  const staticRoot = options.staticRoot === undefined ? defaultDist() : options.staticRoot
  if (staticRoot) {
    registerStatic(app, { root: staticRoot })
  } else {
    app.setNotFoundHandler(async (_request, reply) =>
      reply.code(404).send({ error: 'That page was not found.' }),
    )
  }

  return app
}
