import { test, expect } from '@playwright/test'
import {
  addSpriteFromLibrary, consoleLines, run, setEditorContent, waitForLibrary,
} from './helpers'

test.skip(!process.env.E2E_SERVER, 'Saving needs the real server (run with E2E_SERVER=1)')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForLibrary(page)
})

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
