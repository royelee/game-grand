/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // The stage runs in <iframe sandbox="allow-scripts">, which gives it an
    // opaque ("null") origin. Module scripts are always fetched in CORS mode,
    // so without this header the iframe cannot load its own bundle and the
    // stage stays blank. Serving these public static files to any origin is
    // safe, and it lets us keep the strong sandbox (no allow-same-origin).
    // Any production server must send the same header — see docs/TODO.md.
    headers: { 'Access-Control-Allow-Origin': '*' },
    // Save/Load talk to the Fastify server. Without this, /api/* falls through
    // to the SPA fallback and returns HTML, so saving fails with a confusing
    // message. Run `make server-dev` alongside `make dev`.
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: true } },
  },
  preview: {
    headers: { 'Access-Control-Allow-Origin': '*' },
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: true } },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        runtime: resolve(__dirname, 'runtime.html'),
      },
    },
  },
  test: {
    environment: 'node',
    // e2e/ is Playwright's; vitest would otherwise pick up its .spec.ts files.
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
  },
})
