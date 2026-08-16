import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { isInternalUrl } from './urlPolicy.js'
import { shouldShowOfflinePage } from './loadFailure.js'

// The app ships no client bundle: it points at the deployed Worker, so a
// Cloudflare deploy updates every installed copy. GAME_GRAND_URL aims it at
// `make dev` or `make worker-dev` instead.
const APP_URL = process.env.GAME_GRAND_URL ?? 'https://play.game-grand.workers.dev'
const APP_ORIGIN = new URL(APP_URL).origin
const OFFLINE_PAGE = fileURLToPath(new URL('./offline.html', import.meta.url))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // The IDE is a stage-and-editor split; below this it stops being usable.
    minWidth: 1024,
    minHeight: 700,
    title: 'Game Grand',
    // Matches the crest's dark, so launching does not flash white.
    backgroundColor: '#12192C',
    // No webPreferences on purpose. The renderer loads remote content, so it
    // gets Electron's defaults and nothing more: contextIsolation on,
    // nodeIntegration off, sandbox on, no preload, no IPC.
    //
    // webSecurity must never be turned off here. This codebase talks about
    // CORS constantly, which makes it a tempting-looking fix for any loading
    // problem — and it would dissolve the opaque-origin iframe that keeps
    // user code out of the app's realm.
  })

  // window.open and target="_blank". The IDE has no popups of its own, so
  // every one of these is an outbound link.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternalUrl(url, APP_ORIGIN)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    // Same-origin navigation covers /p/<id> and the offline page's retry.
    if (isInternalUrl(url, APP_ORIGIN)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  win.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (!shouldShowOfflinePage({ isMainFrame, errorCode })) return
    void win.loadFile(OFFLINE_PAGE, { query: { url: APP_URL } })
  })

  void win.loadURL(APP_URL)
}

// Electron's default menu is kept deliberately. Trimming it is the obvious way
// to make a wrapper feel native, and on macOS it silently breaks Monaco: Cmd+C
// and Cmd+V in the editor are delivered through the Edit menu's roles.

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS apps conventionally stay in the Dock with no windows open.
  if (process.platform !== 'darwin') app.quit()
})
