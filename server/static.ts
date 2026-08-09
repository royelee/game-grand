import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { relative, sep } from 'node:path'

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
    setHeaders(reply: FastifyReply, filePath: string) {
      // Compare against the path relative to the served root: an unanchored
      // substring test would match a nested file that merely happens to be
      // named runtime.html, or any file if an ancestor directory is called
      // "assets".
      const fromRoot = relative(options.root, filePath)
      if (fromRoot === 'runtime.html') {
        reply.header('Access-Control-Allow-Origin', '*')
        reply.header('Content-Security-Policy', "frame-ancestors 'self'")
      } else if (fromRoot.startsWith(`assets${sep}`)) {
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
    // A request that names a file — an asset path, or anything with an
    // extension — is a genuinely missing file, not a client route. Serving
    // index.html for those masks a broken bundle reference (e.g. a stale
    // hashed filename after a redeploy) as a 200 full of HTML.
    const path = request.url.split('?')[0]
    if (path.startsWith('/assets/') || /\.[a-zA-Z0-9]+$/.test(path)) {
      return reply.code(404).send({ error: 'That file was not found.' })
    }
    return reply.sendFile('index.html')
  })
}
