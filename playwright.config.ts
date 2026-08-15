import { defineConfig, devices } from '@playwright/test'

// E2E_PREVIEW=1 runs the suite against the production build instead of the
// dev server — the bundled runtime.html is a genuinely different code path.
// E2E_SERVER=1 runs it against the real Fastify server (the configuration
// users get), with save/load exercised against a disposable SQLite file.
// E2E_WORKER=1 runs it against the real Cloudflare Worker via `wrangler dev`
// with a local D1 — the only mode that covers the _headers rules, the
// /p/<id> asset fallback, and D1 itself.
const WORKER = !!process.env.E2E_WORKER
const SERVER = !!process.env.E2E_SERVER
const PREVIEW = !!process.env.E2E_PREVIEW
const PORT = WORKER ? 5177 : SERVER ? 5176 : PREVIEW ? 5175 : 5174
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Locally a retry hides a real flake, so keep it at 0. CI is different:
  // `adds a Scratch sprite with its whole costume set` downloads Abby's
  // costumes from assets.scratch.mit.edu for real, so a hiccup at MIT would
  // otherwise fail a run that has nothing wrong with it.
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // setEditorContent pastes into Monaco rather than typing into it.
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: WORKER
      ? `npm run build && npx wrangler d1 migrations apply game-grand --local && npx wrangler dev --port ${PORT} --local`
      : SERVER
      ? `npm run build && DB_FILE=.e2e-projects.db PORT=${PORT} npm run server`
      : PREVIEW
        ? `npm run build && npm run preview -- --port ${PORT} --strictPort`
        : `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
