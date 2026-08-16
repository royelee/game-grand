import { describe, it, expect } from 'vitest'
import { shouldShowOfflinePage } from './loadFailure.js'

// Chromium net error codes.
const ABORTED = -3
const INTERNET_DISCONNECTED = -106
const NAME_NOT_RESOLVED = -105

describe('shouldShowOfflinePage', () => {
  it('shows the page when the main frame genuinely fails', () => {
    expect(shouldShowOfflinePage({ isMainFrame: true, errorCode: INTERNET_DISCONNECTED })).toBe(true)
    expect(shouldShowOfflinePage({ isMainFrame: true, errorCode: NAME_NOT_RESOLVED })).toBe(true)
  })

  // A cancelled navigation reports ERR_ABORTED. Treating it as a failure would
  // replace a perfectly good IDE with an error screen.
  it('ignores ERR_ABORTED', () => {
    expect(shouldShowOfflinePage({ isMainFrame: true, errorCode: ABORTED })).toBe(false)
  })

  // The one subframe here is the runtime iframe. A game that cannot load is
  // the running game's problem and the app reports it itself.
  it('ignores subframe failures entirely', () => {
    expect(shouldShowOfflinePage({ isMainFrame: false, errorCode: INTERNET_DISCONNECTED })).toBe(false)
    expect(shouldShowOfflinePage({ isMainFrame: false, errorCode: ABORTED })).toBe(false)
  })
})
