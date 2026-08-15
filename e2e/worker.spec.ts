import { test, expect } from '@playwright/test'

// These assert Cloudflare's own asset serving, which no other mode exercises:
// the Fastify server implements the same rules in server/static.ts and is
// covered by server/app.test.ts, but a misconfigured wrangler.jsonc would pass
// every one of those and still ship a blank stage.
test.skip(!process.env.E2E_WORKER, 'Only meaningful against wrangler dev (E2E_WORKER=1)')

test('runtime.html is served directly, with the headers the sandboxed stage needs', async ({
  request,
}) => {
  const res = await request.get('/runtime.html', { maxRedirects: 0 })

  // Not a redirect. Cloudflare's default html_handling 307s this to /runtime,
  // where the _headers rules no longer match and both headers below vanish.
  expect(res.status()).toBe(200)

  // Without this the iframe cannot fetch its own module bundle and the stage
  // silently stays blank — there is no error anyone would ever see.
  expect(res.headers()['access-control-allow-origin']).toBe('*')
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'self'")
})

test('the stage bundle is readable cross-origin, or the stage never boots', async ({ request }) => {
  const html = await (await request.get('/runtime.html')).text()
  const bundle = /src="([^"]*runtime-[^"]+\.js)"/.exec(html)?.[1]
  expect(bundle, 'runtime.html should reference a runtime bundle').toBeTruthy()

  const res = await request.get(bundle!)
  expect(res.status()).toBe(200)
  expect(res.headers()['access-control-allow-origin']).toBe('*')
})

test('an unknown /p/ link serves the IDE so the app can route it', async ({ request }) => {
  const res = await request.get('/p/aaaaaaaaaaaaaaaaaaaaaa')
  expect(res.status()).toBe(200)
  expect(await res.text()).toContain('<div id="root">')
})

test('a missing asset still 404s rather than being masked as the IDE', async ({ request }) => {
  // The single-page-application fallback must not swallow a genuinely missing
  // bundle: that would turn a broken deploy into a blank page instead of an
  // error.
  const res = await request.get('/assets/definitely-not-here.js')
  expect(res.status()).toBe(404)
})
