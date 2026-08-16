/**
 * The window shows one origin: the deployed playground. A link anywhere else
 * belongs in the user's real browser, which has a URL bar, history and their
 * own extensions — none of which a chrome-less window has.
 *
 * Scratch's CDN is deliberately not special-cased. `assets.scratch.mit.edu` is
 * reached by fetch(), never by navigation, so this is never asked about it.
 */
export function isInternalUrl(url: string, appOrigin: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // A relative or malformed target is not something to hand to the browser.
    return false
  }
  return parsed.origin === appOrigin
}
