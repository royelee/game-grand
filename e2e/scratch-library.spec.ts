import { test, expect } from '@playwright/test'
import { pickFromScratch, run, stage, waitForLibrary } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForLibrary(page)
})

test('adds a Scratch sprite with its whole costume set, and it runs', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add sprite' }).click()
  await pickFromScratch(page, 'Abby')

  await expect(page.locator('.sprite-row')).toContainText('Abby')
  await expect(page.locator('.sprite-row img')).toHaveAttribute('src', /^data:/)

  await run(page)
  await expect(stage(page).locator('canvas')).toBeVisible()
})

test('searching narrows the catalog, and a tag chip narrows it further', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add sprite' }).click()

  const count = page.locator('.library-dialog .library-count')
  await expect(count).toContainText('339 found')

  await page.locator('.library-dialog .library-search').fill('cat')
  const afterSearch = await count.textContent()
  expect(Number(afterSearch?.match(/\d+/)?.[0])).toBeLessThan(339)

  await page.locator('.library-dialog .library-chips button', { hasText: 'animals' }).click()
  await expect(page.locator('.library-dialog .library-grid .library-entry').first()).toBeVisible()
})

test('shows a friendly error and keeps the built-ins when the CDN is down', async ({ page }) => {
  await page.route('https://assets.scratch.mit.edu/**', route => route.abort())

  await page.getByRole('button', { name: '+ Add sprite' }).click()
  await page.locator('.library-dialog .library-search').fill('Abby')
  await page
    .locator('.library-dialog .library-grid .library-entry')
    .filter({ hasText: 'Abby' })
    .getByRole('button', { name: 'Use this' })
    .first()
    .click()

  await expect(page.locator('.library-dialog .library-error')).toBeVisible()
  await expect(page.locator('.library-dialog')).toBeVisible()
  await expect(page.locator('.sprite-row')).toHaveCount(0)

  // The built-in ten still work with the CDN dead.
  await page.locator('.library-dialog .library-builtin .library-entry').filter({ hasText: 'Cat' })
    .getByRole('button', { name: 'Use this' }).first().click()
  await expect(page.locator('.sprite-row')).toContainText('Cat')
})

test.describe('saved games', () => {
  test.skip(!process.env.E2E_SERVER, 'Saving needs the real server (run with E2E_SERVER=1)')

  test('a Scratch costume survives a save and reload', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add sprite' }).click()
    await pickFromScratch(page, 'Abby')

    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Saved')).toBeVisible()

    await page.reload()
    await waitForLibrary(page)

    await expect(page.locator('.sprite-row')).toContainText('Abby')
    await expect(page.locator('.sprite-row img')).toHaveAttribute('src', /^data:/)
    await run(page)
    await expect(stage(page).locator('canvas')).toBeVisible()
  })
})
