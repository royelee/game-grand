/** Chromium's ERR_ABORTED — a cancelled navigation, not a fault. */
const ERR_ABORTED = -3

/**
 * `did-fail-load` is noisy: it fires for every subframe and for ordinary
 * cancelled navigations as well as for real failures. Only a main-frame
 * failure that is not a cancellation means the window has nothing to show.
 */
export function shouldShowOfflinePage(event: {
  isMainFrame: boolean
  errorCode: number
}): boolean {
  if (!event.isMainFrame) return false
  return event.errorCode !== ERR_ABORTED
}
