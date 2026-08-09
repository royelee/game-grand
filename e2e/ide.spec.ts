import { test, expect } from '@playwright/test'
import {
  addSpriteFromLibrary, chooseBackdrop, consoleLines, pickFromLibrary, run,
  selectTab, setEditorContent, stage, stop, tinyPngBuffer, tinyWavBuffer, waitForLibrary,
} from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForLibrary(page)
})

test('loads with an empty stage, a main tab, and no sprites', async ({ page }) => {
  await expect(page.locator('.stage-empty')).toContainText('Press Run to play your game')
  await expect(page.locator('.tab')).toHaveCount(1)
  await expect(page.locator('.tab')).toHaveText('main')
  await expect(page.locator('.sprite-list')).toContainText('No sprites yet')
  await expect(page.getByRole('button', { name: '■ Stop' })).toBeDisabled()
})

test('adds a sprite from the library, giving it a tab and a thumbnail', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')

  await expect(page.locator('.sprite-row')).toHaveCount(1)
  await expect(page.locator('.sprite-row')).toContainText('Cat')
  const thumb = page.locator('.sprite-row img')
  await expect(thumb).toHaveAttribute('src', /^data:image\/svg\+xml/)
  await expect(page.locator('.tab')).toHaveText(['main', 'Cat'])
  await expect(page.locator('.tab.active')).toHaveText('Cat')
})

test('uploads an image as a sprite costume, and the game runs with it', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add sprite' }).click()
  await page.locator('.library-dialog input[type="file"]').setInputFiles({
    name: 'rocket.png',
    mimeType: 'image/png',
    buffer: tinyPngBuffer(),
  })

  await expect(page.locator('.library-dialog')).toHaveCount(0)
  await expect(page.locator('.sprite-row')).toHaveCount(1)
  await expect(page.locator('.sprite-row')).toContainText('rocket')
  await expect(page.locator('.sprite-row img')).toHaveAttribute('src', /^data:image\/png/)
  await expect(page.locator('.tab.active')).toHaveText('rocket')

  await run(page)
  await expect(stage(page).locator('canvas')).toBeVisible()
  await expect(page.locator('.console .issue')).toHaveCount(0)
})

test('runs a game: the stage mounts, the script executes, and logs reach the console', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(page, 'onStart(() => console.log("hello from cat"))')
  await run(page)

  await expect(stage(page).locator('canvas')).toBeVisible()
  await expect(consoleLines(page)).toContainText(['hello from cat'])
  await expect(page.getByRole('button', { name: '▶ Run' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '■ Stop' })).toBeEnabled()
})

test('reports a script error with the sprite name and line, and keeps other handlers alive', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(
    page,
    'onStart(() => sprite.move("fast"))\nonStart(() => console.log("second handler ran"))',
  )
  await run(page)

  const issue = page.locator('.console .issue')
  await expect(issue).toHaveCount(1)
  await expect(issue).toContainText('In Cat, line 1:')
  await expect(issue).toContainText('`move` needs a number')
  await expect(consoleLines(page)).toContainText(['second handler ran'])
})

test('main and sprite scripts share vars', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  // The watcher itself is drawn inside the canvas, so assert on the shared
  // value the way a kid would debug it: read it back through console.log.
  await setEditorContent(
    page,
    'onStart(() => { vars.score = vars.score + 5; console.log("score is " + vars.score) })',
  )
  await selectTab(page, 'main')
  await setEditorContent(page, 'vars.score = 10\nwatch("score")')

  await run(page)
  await expect(consoleLines(page)).toContainText(['score is 15'])
  await expect(page.locator('.console .issue')).toHaveCount(0)
})

test('Stop tears the stage down and Run starts a fresh one', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(page, 'onStart(() => console.log("run started"))')

  await run(page)
  await expect(stage(page).locator('canvas')).toBeVisible()
  await expect(consoleLines(page)).toHaveCount(1)

  await stop(page)
  await expect(page.locator('iframe[title="Game stage"]')).toHaveCount(0)
  await expect(page.locator('.stage-empty')).toBeVisible()

  await run(page)
  await expect(stage(page).locator('canvas')).toBeVisible()
  // A fresh run clears the console and the script runs again from scratch.
  await expect(consoleLines(page)).toHaveCount(1)
  await expect(consoleLines(page)).toContainText(['run started'])
})

test('a script calling stopAll returns the UI to the stopped state', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(page, 'onStart(() => { console.log("bye"); stopAll() })')
  await run(page)

  await expect(consoleLines(page)).toContainText(['bye'])
  await expect(page.getByRole('button', { name: '▶ Run' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '■ Stop' })).toBeDisabled()
})

test('keyboard input reaches the running game', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(
    page,
    'onKeyPress("right", () => console.log("moved to " + Math.round(sprite.x)))',
  )
  await run(page)
  await expect(stage(page).locator('canvas')).toBeVisible()

  await stage(page).locator('canvas').click()
  await page.keyboard.press('ArrowRight')

  await expect(consoleLines(page)).toContainText([/moved to/])
})

test('clicking a sprite on the stage fires its onClick handler', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(page, 'onClick(() => console.log("sprite was clicked"))')
  await run(page)
  await expect(stage(page).locator('canvas')).toBeVisible()

  // The cat starts at the stage centre.
  await stage(page).locator('canvas').click({ position: { x: 240, y: 180 } })
  await expect(consoleLines(page)).toContainText(['sprite was clicked'])
})

test('switching the backdrop is reflected by the running game', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await chooseBackdrop(page, 'Night')

  // The project now has two backdrops with Night selected; a script switching
  // back to blue-sky must fire the backdrop event the kid registered.
  await selectTab(page, 'main')
  await setEditorContent(
    page,
    'onBackdropSwitch("blue-sky", () => console.log("back to daytime"))',
  )
  await selectTab(page, 'Cat')
  await setEditorContent(page, 'onStart(() => stage.switchBackdrop("blue-sky"))')

  await run(page)
  await expect(stage(page).locator('canvas')).toBeVisible()
  await expect(consoleLines(page)).toContainText(['back to daytime'])
  await expect(page.locator('.console .issue')).toHaveCount(0)
})

test('the API reference drawer searches by intent and inserts runnable code', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')

  const drawer = page.locator('.drawer')
  await expect(drawer).toBeVisible()
  await drawer.locator('input').fill('bubble')
  await expect(drawer.locator('.api-entry')).toContainText([/sprite\.say/])

  await setEditorContent(page, '')
  await drawer.locator('.api-entry').filter({ hasText: 'sprite.say' }).first()
    .getByRole('button', { name: 'Insert example' }).click()

  await expect(page.locator('.monaco-editor')).toContainText('sprite.say')
  await run(page)
  // The inserted example must run without producing an error.
  await expect(stage(page).locator('canvas')).toBeVisible()
  await expect(page.locator('.console .issue')).toHaveCount(0)
})

test('the API drawer can be hidden and shown', async ({ page }) => {
  await expect(page.locator('.drawer')).toBeVisible()
  await page.getByRole('button', { name: /API reference/ }).click()
  await expect(page.locator('.drawer')).toHaveCount(0)
  await page.getByRole('button', { name: /API reference/ }).click()
  await expect(page.locator('.drawer')).toBeVisible()
})

test('deleting the selected sprite falls back to the main tab', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await expect(page.locator('.tab.active')).toHaveText('Cat')

  await page.locator('.sprite-row').getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.sprite-row')).toHaveCount(0)
  await expect(page.locator('.tab.active')).toHaveText('main')
})

test('renaming a sprite keeps its script and renames its tab', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(page, 'onStart(() => console.log("renamed sprite ran"))')

  page.once('dialog', dialog => dialog.accept('Kitty'))
  await page.locator('.sprite-row').getByRole('button', { name: 'Rename' }).click()

  await expect(page.locator('.tab')).toHaveText(['main', 'Kitty'])
  await run(page)
  await expect(consoleLines(page)).toContainText(['renamed sprite ran'])
})

test('two sprites both run their own scripts', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(page, 'onStart(() => console.log("cat ran"))')
  await addSpriteFromLibrary(page, 'Bat')
  await setEditorContent(page, 'onStart(() => console.log("bat ran"))')

  await run(page)
  await expect(consoleLines(page)).toContainText(['cat ran', 'bat ran'])
})

test('clones spawn and report themselves', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(
    page,
    'onStart(() => { sprite.clone(); sprite.clone() })\nonCloneStart(() => console.log("clone appeared"))',
  )
  await run(page)
  await expect(page.locator('.console').getByText('clone appeared')).toHaveCount(2)
})

test('a sound can be added from the library and played by a script', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')

  await page.getByRole('button', { name: 'Sounds' }).click()
  await pickFromLibrary(page, 'Beep')

  await setEditorContent(page, 'onStart(() => playSound("beep"))')
  await run(page)

  await expect(stage(page).locator('canvas')).toBeVisible()
  await expect(page.locator('.console .issue')).toHaveCount(0)
})

test('uploads an audio file as a sound, and a script can play it with no error', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await page.getByRole('button', { name: 'Sounds' }).click()
  await page.locator('.library-dialog input[type="file"]').setInputFiles({
    name: 'honk.wav',
    mimeType: 'audio/wav',
    buffer: tinyWavBuffer(),
  })
  await expect(page.locator('.library-dialog')).toHaveCount(0)

  await setEditorContent(page, 'onStart(() => playSound("honk"))')
  await run(page)

  await expect(stage(page).locator('canvas')).toBeVisible()
  await expect(page.locator('.console .issue')).toHaveCount(0)
})

test('playSoundUntilDone resolves so the script continues', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await page.getByRole('button', { name: 'Sounds' }).click()
  await pickFromLibrary(page, 'Pop')

  await setEditorContent(
    page,
    'onStart(async () => { await playSoundUntilDone("pop"); console.log("sound finished") })',
  )
  await run(page)

  await expect(consoleLines(page)).toContainText(['sound finished'])
  await expect(page.locator('.console .issue')).toHaveCount(0)
})

test('naming a sound the project does not have gives a friendly error', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(page, 'onStart(() => playSound("meow"))')
  await run(page)

  const issue = page.locator('.console .issue')
  await expect(issue).toHaveCount(1)
  await expect(issue).toContainText("couldn't find a sound called \"meow\"")
})

test('a failed library load shows a retry banner and recovers', async ({ page }) => {
  await page.route('**/library/library.json', route => route.abort())
  await page.goto('/')

  const banner = page.locator('.banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('didn’t load')
  // Add sprite must not silently do nothing while the library is unavailable.
  await page.getByRole('button', { name: '+ Add sprite' }).click()
  await expect(page.locator('.library-dialog')).toHaveCount(0)

  await page.unroute('**/library/library.json')
  await banner.getByRole('button', { name: 'Try again' }).click()

  await expect(banner).toHaveCount(0)
  await waitForLibrary(page)
  await addSpriteFromLibrary(page, 'Cat')
  await expect(page.locator('.sprite-row')).toHaveCount(1)
})
