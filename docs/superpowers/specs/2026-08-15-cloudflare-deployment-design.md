# Deploying to Cloudflare — Design

**Date:** 2026-08-15
**Status:** Approved by user (clarification session)

## What we're building

A production deployment of the playground on Cloudflare: the built client served from
Workers static assets, the three project endpoints served by a Worker, and project
documents stored in D1. The existing Node + Fastify + SQLite server stays as the local
development and test server.

## Why Cloudflare, and what it costs us

The app has one property that makes most static hosts unusable and one that makes most
serverless hosts unusable:

- The stage runs in `<iframe sandbox="allow-scripts">`, so `runtime.html` and `assets/*`
  **must** carry `Access-Control-Allow-Origin: *`, and `runtime.html` should carry
  `Content-Security-Policy: frame-ancestors 'self'`. A host that cannot set response
  headers per path serves a silently blank stage. Workers static assets support a
  `_headers` file, so both rules survive.
- Saved games must be durable. A kid gets a secret link and comes back next week. Any host
  with an ephemeral filesystem loses those games on the next deploy, which is worse than
  not deploying. D1 is durable, and it is SQLite — the schema and all three queries port
  essentially unchanged.

The cost is that `node:sqlite` does not exist on Workers. D1 is a binding, not a file, and
its API is async where `DatabaseSync` is sync. That is the entire port.

## Decisions made

| Decision | Choice |
|---|---|
| Static hosting | Workers static assets (`assets` binding), not Pages |
| API | The same Worker, via `run_worker_first: ["/api/*"]` |
| Storage | D1 (`game-grand` database, `projects` table — the existing schema) |
| Web framework in the Worker | **None.** Three routes do not justify a router |
| Fastify server | **Kept.** Local dev and the `E2E_SERVER` suite are unchanged |
| Response headers | `public/_headers`, copied into `dist/` by Vite |
| SPA routing for `/p/<id>` | `not_found_handling: "single-page-application"` |
| Deploys | A local script reading `CLOUDFLARE_API_TOKEN` from an uncommitted `.env` |
| Rate limiting | Cloudflare rate-limiting rule + an in-Worker D1 size circuit breaker |

## Architecture

```
                      ┌──────────────── Cloudflare edge ────────────────┐
  GET /              │  assets binding → dist/index.html                │
  GET /runtime.html  │  assets binding → dist/runtime.html              │
                     │    + _headers: ACAO *, frame-ancestors 'self'    │
  GET /assets/*      │  assets binding + _headers: ACAO *               │
  GET /p/<id>        │  not_found_handling: single-page-application     │
                     │    → dist/index.html, the IDE routes it          │
                     │                                                  │
  POST /api/projects │  run_worker_first → worker/index.ts              │
  GET  /api/…/:id    │      ↓                                           │
  PUT  /api/…/:id    │  handleApiRequest()  ← shared with Fastify       │
                     │      ↓                                           │
                     │  D1ProjectStore → env.DB (D1, SQLite)            │
                     └──────────────────────────────────────────────────┘
```

### The shared core

Today `server/routes.ts` is Fastify-shaped: it takes a `FastifyInstance` and registers
handlers. The Worker cannot use it, and duplicating the logic would let the two
implementations drift — which matters because the validation in it is the only thing
standing between a kid's browser and the database.

So the routing logic moves into one pure function in `src/shared/`:

```ts
handleApiRequest(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse>
```

`ApiRequest` is `{ method, path, body }`, `ApiResponse` is `{ status, body, headers? }` —
plain data, no framework types, no `Response`, no `FastifyReply`. Fastify and the Worker
each become a thin adapter that translates their own request into `ApiRequest` and their
own reply out of `ApiResponse`. The existing kid-facing error messages travel with it
unchanged.

### The storage seam

Both stores implement one async interface:

```ts
interface ProjectStore {
  create(document: string, now: number): Promise<string>
  load(id: string): Promise<StoredProject | null>
  update(id: string, document: string, now: number): Promise<boolean>
}
```

`create`/`load`/`update` are already the whole surface. Making them async costs the
existing Fastify path nothing (its handlers are already `async`) and is required for D1.

`update` returning a boolean maps exactly onto both backends: `node:sqlite` reports
`result.changes`, and D1 reports `meta.changes`. Neither needs a follow-up SELECT.

### Ids must work in both runtimes

`server/ids.ts` uses `node:crypto`'s `randomBytes`, which Workers does not provide without
a compatibility flag. Web Crypto's `crypto.getRandomValues` exists in Node 24 **and** in
Workers, so the id generator moves to `src/shared/` and uses it. Base64url is produced by
hand rather than through `Buffer`, for the same reason.

The security property is unchanged: 16 random bytes, 22 base64url characters.

### Logging: the id is still a capability

`server/app.ts` installs a pino serializer that rewrites `/api/projects/<id>` and `/p/<id>`
out of every log line, because whoever reads a log line holds edit rights to that game.
The Worker has no pino, and Cloudflare captures `console` output plus request URLs.

**Two consequences the implementation must respect:**

1. The Worker must never `console.log` a request URL, a path, or an id. It logs the method
   and the outcome only.
2. Cloudflare's own request logging (Logpush, and the dashboard's live tail) records full
   URLs including the path. Enabling Logpush on this Worker would defeat the redaction that
   `server/app.test.ts` exists to protect. This is recorded in `docs/TODO.md` rather than
   solved, because it is a configuration choice, not code.

### Rate limiting is a precondition, not a follow-up

`docs/TODO.md` records this as a hard pre-deployment requirement: `POST /api/projects` is
unauthenticated and unmetered, so a loop of maximum-size creates fills storage and takes
everyone's saves down. Deploying without it is exactly the failure the entry warns about.

Two layers, because they fail differently:

- **A Cloudflare rate-limiting rule** on `/api/projects` — stops the flood at the edge
  before it costs a Worker invocation or a D1 write. Configured in the dashboard, not in
  code, so it is a deploy step with a verification step.
- **A storage circuit breaker in the Worker** — before an insert, if the `projects` table
  exceeds a row threshold, `POST` returns a kid-facing refusal. This catches the slow fill
  that a per-minute rate limit never notices, and it is testable.

Both must be in place before the first public link is shared.

## The deploy path

Deploys run from the developer's machine, not CI. The token lives in `.env`, which is
**not** committed — a rule that did not exist before this work and is added by it.

This moves a guarantee. With CI deploys, `main` being protected meant every deploy was a
deploy of tested code. A local script has no such guarantee, so the script itself is the
gate and refuses to deploy when:

- the working tree is dirty (you would ship something you cannot reproduce from a commit),
- `HEAD` is not on `main`,
- the unit suite or the build fails.

`.env` is read by the script and exported only into the `wrangler` child process.

## Testing

The existing three e2e modes are untouched. A fourth is added:

`E2E_WORKER=1` runs the same specs against `wrangler dev`, which executes the real Worker
against a local D1. This is the only mode that exercises the D1 store, the `_headers`
rules, and the SPA fallback — the three things unit tests structurally cannot reach, and
exactly the class of bug (`Access-Control-Allow-Origin` on the iframe bundle) that the e2e
suite has caught before and review did not.

Unit tests cover the shared handler and the id generator. The D1 store is covered by the
e2e worker mode rather than by a mock, because a mock of D1 would assert our beliefs about
D1 rather than D1's behaviour.

## What does not change

- The save document (`src/shared/project.ts`). One JSON shape, `version: 1`, unchanged.
- Every kid-facing message.
- `src/runtime/`, `src/runtime-host/`, `src/ide/` — the client does not learn it is on
  Cloudflare. `api.ts` keeps using relative `/api/...` paths, because the Worker serves the
  client and the API from one origin.
- The Fastify server, `make server`, and the `E2E_SERVER` suite.

## Deferred — to be recorded in `docs/TODO.md` with the implementation

- Cloudflare request logging records full URLs, including project ids. Logpush must stay
  off, or be configured with a URL-redacting transform, or the capability leaks into logs.
- D1's free tier allows 100k writes/day; the circuit breaker counts rows, not writes, so a
  write flood that stays under the row cap can still exhaust the daily quota.
- No backup of D1. A dropped table loses every saved game. `wrangler d1 export` on a
  schedule would fix it.
- The `projects` table has no index on `updated_at`, so any future "recently updated"
  admin view would table-scan.
