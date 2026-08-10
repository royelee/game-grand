import { test, expect } from '@playwright/test'
import {
  addSpriteFromLibrary, consoleLines, run, setEditorContent, stage, waitForLibrary,
} from './helpers'

// Scripts here are kept short on purpose: setEditorContent pastes into Monaco
// and compares the result, and a long paste is unreliable enough to flake.
// Nine APIs across two tests rather than one long one.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForLibrary(page)
})

test('every pen colour and size setting applies without an issue', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(
    page,
    [
      'onStart(() => {',
      '  sprite.setPenColor("hotpink")',
      '  sprite.setPenSize(4)',
      '  sprite.changePenSize(1)',
      '  sprite.setPen({ saturation: 90, transparency: 10 })',
      '  sprite.changePen({ color: 3 })',
      '  console.log("pen set up")',
      '})',
    ].join('\n'),
  )

  await run(page)
  await expect(stage(page).locator('canvas')).toBeVisible()
  await expect(consoleLines(page)).toContainText(['pen set up'])
  await expect(page.locator('.console .issue')).toHaveCount(0)
})

test('drawing, stamping and erasing run clean in a real browser', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(
    page,
    [
      'onStart(() => {',
      '  eraseAll()',
      '  sprite.penDown()',
      '  for (let i = 0; i < 36; i++) { sprite.move(10); sprite.turnRight(10) }',
      '  sprite.penUp()',
      '  sprite.stamp()',
      '  console.log("drew a circle")',
      '})',
    ].join('\n'),
  )

  await run(page)
  await expect(stage(page).locator('canvas')).toBeVisible()
  await expect(consoleLines(page)).toContainText(['drew a circle'])
  await expect(page.locator('.console .issue')).toHaveCount(0)
})

test('drawing does not disturb where the sprite ends up', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  // The trail is drawn inside the canvas, so assert on the motion the way a kid
  // would debug it: read the position back through console.log.
  await setEditorContent(
    page,
    [
      'onStart(() => {',
      '  sprite.penDown()',
      '  sprite.move(50)',
      '  console.log("x=" + Math.round(sprite.x) + " y=" + Math.round(sprite.y))',
      '})',
    ].join('\n'),
  )

  await run(page)
  await expect(consoleLines(page)).toContainText(['x=50 y=0'])
  await expect(page.locator('.console .issue')).toHaveCount(0)
})

test('a colour the pen does not know is reported for a kid', async ({ page }) => {
  await addSpriteFromLibrary(page, 'Cat')
  await setEditorContent(page, 'onStart(() => sprite.setPenColor("blurple"))')

  await run(page)
  const issue = page.locator('.console .issue')
  await expect(issue).toHaveCount(1)
  await expect(issue).toContainText('doesn\'t know the color "blurple"')
  await expect(issue).toContainText('Try a color name like "red"')
})
