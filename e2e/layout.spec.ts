import { test, expect, type Page } from '@playwright/test'
import { addSpriteFromLibrary, run, waitForLibrary } from './helpers'

/**
 * The IDE is an app shell: it is pinned to the viewport and every pane scrolls
 * inside its own box. These tests exist because it used to do the opposite —
 * opening the API reference or the sprite library grew the *document* to
 * 5765px and 14871px respectively on a 900px viewport, leaving the whole IDE
 * scrolled off-screen after picking a sprite.
 *
 * See docs/superpowers/specs/2026-08-09-viewport-layout-design.md.
 */

/** How far the document can be scrolled, in px. Zero means the shell fits. */
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  )
}

/** Asserts the document has not grown past the viewport, with a px of slack for rounding. */
async function expectNoPageScroll(page: Page, state: string): Promise<void> {
  expect(await pageOverflow(page), `the page grew past the viewport ${state}`).toBeLessThanOrEqual(1)
}

function box(page: Page, selector: string) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel)
    if (!el) throw new Error(`no element matched ${sel}`)
    const rect = el.getBoundingClientRect()
    return {
      top: Math.round(rect.top),
      height: Math.round(rect.height),
      width: Math.round(rect.width),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      clientWidth: el.clientWidth,
    }
  }, selector)
}

/**
 * Fills the editor without reading it back.
 *
 * `helpers.setEditorContent` verifies the paste landed by comparing
 * `.view-lines`, which only works for a document short enough to render in
 * full — Monaco virtualizes beyond that. These tests want a deliberately
 * over-long document, so they check the layout rather than the text.
 */
async function pasteIntoEditor(page: Page, code: string): Promise<void> {
  const editor = page.locator('.monaco-editor').first()
  await editor.waitFor()
  await page.locator('.monaco-editor textarea').first().waitFor({ state: 'attached' })
  await page.evaluate(text => navigator.clipboard.writeText(text), code)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('ControlOrMeta+V')
  // The caret lands at the end, so the tail is what is rendered — the head has
  // already been virtualized away, which is itself the point being made.
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('line 199')
}

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 620 },
]

for (const viewport of VIEWPORTS) {
  const at = `at ${viewport.width}x${viewport.height}`

  test(`the shell stays pinned to the viewport through every pane ${at}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await waitForLibrary(page)
    await expectNoPageScroll(page, 'at rest')

    // The API reference defaults to shown, so hide-then-show covers both.
    await page.getByRole('button', { name: 'Hide API reference' }).click()
    await expectNoPageScroll(page, 'with the API reference hidden')
    await page.getByRole('button', { name: 'Show API reference' }).click()
    await expectNoPageScroll(page, 'with the API reference shown')

    await page.getByRole('button', { name: '+ Add sprite' }).click()
    await expect(page.locator('.library-dialog')).toBeVisible()
    await expectNoPageScroll(page, 'with the sprite library open')

    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Load' }).click()
    await expect(page.locator('.load-dialog')).toBeVisible()
    await expectNoPageScroll(page, 'with the Load dialog open')
    await page.getByRole('button', { name: 'Close' }).click()

    await addSpriteFromLibrary(page, 'Cat')
    await expectNoPageScroll(page, 'after adding a sprite')
    // The old bug did not just grow the page, it left the user parked at the
    // bottom of it with the IDE out of sight.
    expect(await page.evaluate(() => window.scrollY)).toBe(0)

    const longScript = Array.from(
      { length: 200 },
      (_, i) => `onStart(() => console.log("line ${i}"))`,
    ).join('\n')
    await pasteIntoEditor(page, longScript)
    await expectNoPageScroll(page, 'with a 200-line script in the editor')

    await run(page)
    await expect(page.locator('.console > div').first()).toBeVisible()
    await expectNoPageScroll(page, 'with the console full of output')
  })
}

test('each pane scrolls inside its own box rather than growing the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await waitForLibrary(page)

  // The API reference lists every builtin, so it always overflows 900px.
  const drawer = box(page, '.code-area > .drawer')
  expect((await drawer).scrollHeight).toBeGreaterThan((await drawer).clientHeight)
  await page.locator('.code-area > .drawer').evaluate(el => el.scrollBy(0, 400))
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await expectNoPageScroll(page, 'after scrolling the API reference')

  await page.getByRole('button', { name: '+ Add sprite' }).click()
  await expect(page.locator('.library-dialog')).toBeVisible()
  // The dialog only overflows once the Scratch catalog has arrived — with the
  // built-in five it comfortably fits. waitForLibrary above does not cover
  // that: the catalog is a separate, non-fatal load (see App.tsx), and
  // .library-count renders only when it has landed. Measuring before then
  // asserts against a half-loaded dialog, which is why this flaked under a
  // slower server rather than failing outright.
  await expect(page.locator('.library-dialog .library-count')).toBeVisible()
  const body = await box(page, '.library-dialog .drawer-body')
  expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
  await page.locator('.library-dialog .drawer-body').evaluate(el => el.scrollBy(0, 2000))
  await expectNoPageScroll(page, 'after scrolling the sprite library')
})

test('Monaco sizes itself to the pane instead of inflating it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await waitForLibrary(page)

  // The regression this guards: `height="100%"` against an indefinite ancestor
  // made the editor measure 5519px on a 900px viewport.
  const editor = await box(page, '.editor')
  expect(editor.height).toBeLessThan(900)
  expect(editor.height).toBeGreaterThan(100)
})

test('the sprite library overlays the left column and keeps Close in reach', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await waitForLibrary(page)

  const panel = await box(page, '.panel')
  await page.getByRole('button', { name: '+ Add sprite' }).click()
  await expect(page.locator('.library-dialog')).toBeVisible()

  // Against the panel's *client* box: the dialog is positioned `inset: 0`, so
  // its containing block excludes the panel's 1px border-right.
  const dialog = await box(page, '.library-dialog')
  expect(dialog.height).toBe(panel.clientHeight)
  expect(dialog.width).toBe(panel.clientWidth)
  expect(dialog.top).toBe(panel.top)

  // The toolbar must not scroll away with the 886-card grid beneath it.
  const toolbarBefore = await box(page, '.library-dialog > .toolbar')
  await page.locator('.library-dialog .drawer-body').evaluate(el => el.scrollBy(0, 3000))
  const toolbarAfter = await box(page, '.library-dialog > .toolbar')
  expect(toolbarAfter.top).toBe(toolbarBefore.top)
  await expect(page.getByRole('button', { name: 'Close' })).toBeInViewport()
})
