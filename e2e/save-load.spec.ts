import { test, expect, type Page } from '@playwright/test'
import {
  addSpriteFromLibrary, consoleLines, editorText, run, setEditorContent, stage, tinyPngBuffer, waitForLibrary,
} from './helpers'

test.skip(!process.env.E2E_SERVER, 'Saving needs the real server (run with E2E_SERVER=1)')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForLibrary(page)
})

const openLibraryEntry = (page: Page, name: string) =>
  page.locator('.load-dialog .library-entry').filter({ hasText: name }).getByRole('button', { name: 'Open' }).click()

/**
 * Saves two games on this device — game A with a Cat sprite, game B with a
 * Ball sprite — then reopens game A so it's the current, freshly-saved
 * project. Used by the discard-unsaved-work tests below, which each need a
 * second saved game to try opening over the current one.
 */
async function saveTwoGamesAndReopenA(page: Page): Promise<{ urlA: string; urlB: string }> {
  await addSpriteFromLibrary(page, 'Cat')
  await page.getByLabel('Game name').fill('Game A')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')
  const urlA = page.url()

  await page.goto('/')
  await waitForLibrary(page)
  await addSpriteFromLibrary(page, 'Ball')
  await page.getByLabel('Game name').fill('Game B')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')
  const urlB = page.url()

  // Back to a blank project, then reopen game A as "the current game" — a
  // clean open with nothing unsaved, so it doesn't itself trigger a confirm.
  await page.goto('/')
  await waitForLibrary(page)
  await page.getByRole('button', { name: 'Load' }).click()
  await openLibraryEntry(page, 'Game A')
  await expect(page).toHaveURL(urlA)

  return { urlA, urlB }
}

test('saves a game and reopens it from its link', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(page, 'onStart(() => console.log("saved cat ran"))')
  await page.getByLabel('Game name').fill('Cat Chase')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.locator('.save-status')).toHaveText('Saved')
  await expect(page).toHaveURL(/\/p\/[A-Za-z0-9_-]{22}$/)
  const link = page.url()

  // A different browser context — proves the link, not local storage, carries it.
  const fresh = await page.context().browser()!.newContext()
  const other = await fresh.newPage()
  await other.goto(link)
  await waitForLibrary(other)

  await expect(other.locator('.sprite-row')).toContainText('Cat')
  await expect(other.getByLabel('Game name')).toHaveValue('Cat Chase')
  await other.getByRole('button', { name: '▶ Run' }).click()
  await expect(other.locator('.console > div')).toContainText(['saved cat ran'])
  await fresh.close()
})

test('an uploaded costume survives a save and reopens in a fresh browser, ready to run', async ({ page }) => {
  // Uploaded assets carry their dimensions only in the in-memory AssetStore,
  // seeded at upload time — never in the saved project document itself. A
  // fresh browser context has no memory of that upload, so this is the only
  // way to catch a resolver that assumes the store is already populated.
  await page.getByRole('button', { name: '+ Add sprite' }).click()
  await page.locator('.library-dialog input[type="file"]').setInputFiles({
    name: 'rocket.png',
    mimeType: 'image/png',
    buffer: tinyPngBuffer(),
  })
  await expect(page.locator('.sprite-row')).toContainText('rocket')

  await page.getByLabel('Game name').fill('Uploaded Rocket')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')
  const link = page.url()

  const fresh = await page.context().browser()!.newContext()
  const other = await fresh.newPage()
  await other.goto(link)
  await waitForLibrary(other)

  await expect(other.locator('.sprite-row')).toContainText('rocket')
  await expect(other.locator('.sprite-row img')).toHaveAttribute('src', /^data:image\/png/)

  await other.getByRole('button', { name: '▶ Run' }).click()
  await expect(stage(other).locator('canvas')).toBeVisible()
  await expect(other.locator('.console .issue')).toHaveCount(0)
  await fresh.close()
})

test('saving again updates the same game rather than making a new one', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')
  const firstUrl = page.url()

  await setEditorContent(page, 'onStart(() => console.log("second version"))')
  await expect(page.locator('.save-status')).toHaveText('')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')
  expect(page.url()).toBe(firstUrl)

  await page.reload()
  await waitForLibrary(page)
  await run(page)
  await expect(consoleLines(page)).toContainText(['second version'])
})

test('a saved game appears in this device’s list and reopens from it', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await page.getByLabel('Game name').fill('Listed Game')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')

  await page.goto('/')
  await waitForLibrary(page)
  await page.getByRole('button', { name: 'Load' }).click()
  const entry = page.locator('.load-dialog .library-entry').filter({ hasText: 'Listed Game' })
  await entry.getByRole('button', { name: 'Open' }).click()

  await expect(page.locator('.sprite-row')).toContainText('Cat')
  await expect(page).toHaveURL(/\/p\/[A-Za-z0-9_-]{22}$/)
})

test('opening an unknown link explains itself instead of hanging', async ({ page }) => {
  await page.goto('/p/aaaaaaaaaaaaaaaaaaaaaa')
  await expect(page.locator('.console .issue, .save-error')).toContainText(/couldn't find/i)
})

test('pasting a link into the Load dialog opens that game', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await page.getByLabel('Game name').fill('Pasted Game')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')
  const link = page.url()

  const fresh = await page.context().browser()!.newContext()
  const other = await fresh.newPage()
  await other.goto('/')
  await waitForLibrary(other)
  await other.getByRole('button', { name: 'Load' }).click()
  await other.getByLabel('Game link to open').fill(link)
  await other.getByRole('button', { name: 'Open' }).click()
  await expect(other.getByLabel('Game name')).toHaveValue('Pasted Game')
  await fresh.close()
})

test('canceling the unsaved-work prompt keeps the current game and its edit', async ({ page }) => {
  const { urlA } = await saveTwoGamesAndReopenA(page)

  await setEditorContent(page, 'onStart(() => console.log("unsaved edit"))')
  await expect(page.locator('.save-status')).toHaveText('')

  await page.getByRole('button', { name: 'Load' }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await openLibraryEntry(page, 'Game B')

  // Canceling only aborts opening game B — the dialog itself stays open
  // (nothing has changed underneath it yet). Close it to see the sprite list.
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page).toHaveURL(urlA)
  await expect(page.locator('.sprite-row')).toContainText('Cat')
  expect(await editorText(page)).toContain('unsaved edit')
})

test('confirming the unsaved-work prompt discards the edit and opens the other game', async ({ page }) => {
  const { urlB } = await saveTwoGamesAndReopenA(page)

  await setEditorContent(page, 'onStart(() => console.log("unsaved edit"))')
  await expect(page.locator('.save-status')).toHaveText('')

  // Track that a confirm genuinely appeared — accepting an assertion that
  // never fired would make this indistinguishable from having no guard at all.
  let dialogMessage: string | null = null
  page.once('dialog', dialog => {
    dialogMessage = dialog.message()
    void dialog.accept()
  })

  await page.getByRole('button', { name: 'Load' }).click()
  await openLibraryEntry(page, 'Game B')

  await expect(page.getByLabel('Game name')).toHaveValue('Game B')
  await expect(page.locator('.sprite-row')).toContainText('Ball')
  await expect(page).toHaveURL(urlB)
  expect(dialogMessage).toMatch(/aren.t saved yet/i)
})

test('opening another game does not prompt when there is nothing unsaved', async ({ page }) => {
  const { urlB } = await saveTwoGamesAndReopenA(page)

  const dialogMessages: string[] = []
  page.on('dialog', dialog => {
    dialogMessages.push(dialog.message())
    void dialog.dismiss()
  })

  await page.getByRole('button', { name: 'Load' }).click()
  await openLibraryEntry(page, 'Game B')

  await expect(page.getByLabel('Game name')).toHaveValue('Game B')
  await expect(page).toHaveURL(urlB)
  expect(dialogMessages).toEqual([])
})

test('a stale create never rewrites the address bar or remembers the wrong game', async ({ page }) => {
  // A real second game to switch to, saved normally before any delay is introduced.
  await addSpriteFromLibrary(page, 'Ball')
  await page.getByLabel('Game name').fill('Game B')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saved')
  const linkB = page.url()

  // A fresh, never-saved project — its create is the one that will be
  // delayed to resolve after Game B has already been opened.
  await page.goto('/')
  await waitForLibrary(page)
  await addSpriteFromLibrary(page, 'Cat')
  await page.getByLabel('Game name').fill('Game A')

  await page.route('**/api/projects', async route => {
    if (route.request().method() === 'POST') {
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    await route.continue()
  })

  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.save-status')).toHaveText('Saving…')

  // Open Game B (already listed on this device from the save above) while
  // Game A's create is still in flight. The project isn't "saved" yet (it's
  // mid-save), so this goes through the usual unsaved-work confirm like any
  // other switch.
  page.once('dialog', dialog => void dialog.accept())
  await page.getByRole('button', { name: 'Load' }).click()
  await openLibraryEntry(page, 'Game B')

  await expect(page.getByLabel('Game name')).toHaveValue('Game B')
  await expect(page).toHaveURL(linkB)

  // Let the stale create resolve. The reducer already discards it (wrong
  // token), but the bug was that the address bar and recent-games list were
  // rewritten outside the reducer, unconditionally.
  await page.waitForTimeout(1800)
  await expect(page).toHaveURL(linkB)
  await expect(page.getByLabel('Game name')).toHaveValue('Game B')

  await page.getByRole('button', { name: 'Load' }).click()
  await expect(page.locator('.load-dialog')).not.toContainText('Game A')
})
