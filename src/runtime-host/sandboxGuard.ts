/**
 * True only for the opaque ("null") origin a sandboxed iframe gets when it
 * has `sandbox="allow-scripts"` without `allow-same-origin` — exactly how
 * the IDE embeds `runtime.html` (see StagePanel.tsx). Any other origin means
 * this document was loaded directly, or embedded by a page that omitted the
 * sandbox attribute, so it must not be trusted to run a `run` message's
 * script at the app's real origin.
 *
 * Pulled out of main.ts so it can be unit-tested without a DOM: main.ts has
 * module-level side effects (postMessage, addEventListener) that only work
 * in a browser, but this check is pure.
 */
export function isOpaqueOrigin(origin: string): boolean {
  return origin === 'null'
}
