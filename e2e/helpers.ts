import { expect, type Page, type FrameLocator } from '@playwright/test'

/** Wait for the asset library to finish loading (Run enables once it has). */
export async function waitForLibrary(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: '▶ Run' })).toBeEnabled()
}

/** Add a sprite from the built-in library by its label. */
export async function addSpriteFromLibrary(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add sprite' }).click()
  await pickFromLibrary(page, label)
}

/** Choose a backdrop from the built-in library by its label. */
export async function chooseBackdrop(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Backdrop' }).click()
  await pickFromLibrary(page, label)
}

/**
 * Click "Use this" on a built-in library card.
 *
 * Scoped to `.library-builtin` rather than the whole dialog: the Scratch
 * catalog has its own "Cat", so an unscoped match would be ambiguous.
 */
export async function pickFromLibrary(page: Page, label: string): Promise<void> {
  const card = page.locator('.library-dialog .library-builtin .library-entry').filter({ hasText: label })
  await card.getByRole('button', { name: 'Use this' }).first().click()
}

export async function selectTab(page: Page, tab: string): Promise<void> {
  await page.locator('.tab', { hasText: new RegExp(`^${tab}$`) }).click()
}

const normalize = (text: string) =>
  text
    .replace(/ /g, ' ')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()

/** The code Monaco is actually showing, without the line-number gutter. */
export async function editorText(page: Page): Promise<string> {
  return normalize(await page.locator('.monaco-editor .view-lines').first().innerText())
}

/**
 * Replace the active editor's contents by selecting all and pasting.
 *
 * Typing character-by-character is unreliable against Monaco — auto-closing
 * brackets and auto-indent rewrite what you send. Pasting goes through the
 * same path a kid uses when copying an example, and needs no test hooks in
 * production code.
 *
 * Retries because Monaco attaches its model asynchronously after a tab switch;
 * selecting before that lands makes the paste append instead of replace.
 */
export async function setEditorContent(page: Page, code: string): Promise<void> {
  const editor = page.locator('.monaco-editor').first()
  await editor.waitFor()
  await page.locator('.monaco-editor textarea').first().waitFor({ state: 'attached' })
  await page.evaluate(text => navigator.clipboard.writeText(text), code)

  for (let attempt = 0; attempt < 4; attempt++) {
    await editor.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Delete')
    await page.keyboard.press('ControlOrMeta+V')
    if ((await editorText(page)) === normalize(code)) return
    await page.waitForTimeout(150)
  }
  throw new Error(
    `Could not set the editor to:\n${normalize(code)}\n\nIt ended up as:\n${await editorText(page)}`,
  )
}

export function stage(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Game stage"]')
}

export async function run(page: Page): Promise<void> {
  await page.getByRole('button', { name: '▶ Run' }).click()
}

export async function stop(page: Page): Promise<void> {
  await page.getByRole('button', { name: '■ Stop' }).click()
}

export function consoleLines(page: Page) {
  return page.locator('.console > div')
}

/** A minimal valid 1x1 transparent PNG, for exercising the upload-as-costume path. */
export function tinyPngBuffer(): Buffer {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  return Buffer.from(base64, 'base64')
}

/**
 * A minimal valid mono 16-bit PCM WAV, for exercising the upload-as-sound
 * path. Built the same way scripts/make-starter-sounds.mjs builds the
 * shipped library sounds, just shorter.
 */
export function tinyWavBuffer(): Buffer {
  const rate = 8000
  const samples = Array.from({ length: 400 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / rate) * 0.3)
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2))

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
