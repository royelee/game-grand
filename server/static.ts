import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyReply } from 'fastify'

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
    // @fastify/static invokes this with the Fastify Reply object, not a raw
    // Node `res` (despite the option's own name) — its `.header()` is the
    // one that exists here, `.setHeader()` does not.
    setHeaders(reply: FastifyReply, path: string) {
      if (path.endsWith('runtime.html')) {
        reply.header('Access-Control-Allow-Origin', '*')
        reply.header('Content-Security-Policy', "frame-ancestors 'self'")
      } else if (path.includes('/assets/')) {
        reply.header('Access-Control-Allow-Origin', '*')
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
