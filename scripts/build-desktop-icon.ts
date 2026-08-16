import { chromium } from '@playwright/test'
import { mkdir, rm, readFile, copyFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const SVG = 'public/favicon.svg'
const ICONSET = 'desktop/icon.iconset'
const ICNS = 'desktop/icon.icns'

// The ten entries iconutil expects. Rendered once at 1024 and downscaled by
// sips, rather than re-rendered per size: one render is the reference, and
// every smaller icon is a resample of exactly the same artwork.
const MASTER = 'icon_512x512@2x.png'
const DOWNSCALES: Array<{ name: string; size: number }> = [
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_16x16.png', size: 16 },
]

function page(svg: string): string {
  // Fixed pixel units because the viewport is always 1024. The tile is the
  // macOS rounded-rect grid: artwork inset, not full-bleed. The crest is drawn
  // on transparency, so rendering it bare would put a floating shape in a Dock
  // full of rounded squares.
  return `<!doctype html>
<style>
  html, body { margin: 0; width: 1024px; height: 1024px; }
  body { display: grid; place-items: center; }
  .tile {
    width: 840px; height: 840px;
    border-radius: 188px;
    background: linear-gradient(160deg, #F7F3E6 0%, #E4D9BC 100%);
    display: grid; place-items: center;
    box-shadow: 0 12px 28px rgba(18, 25, 44, 0.25);
  }
  /* The crest's drawn content fills only about 58% of its 500x500 viewBox, so
     sizing the <svg> to the tile would leave it looking tiny. 760 puts the
     visible crest at roughly three-quarters of the tile height, which is what
     keeps it readable at 16 and 32 points. */
  .tile svg { width: 760px; height: 760px; }
</style>
<div class="tile">${svg}</div>`
}

const svg = await readFile(SVG, 'utf8')

await rm(ICONSET, { recursive: true, force: true })
await mkdir(ICONSET, { recursive: true })

const browser = await chromium.launch()
const tab = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await tab.setContent(page(svg))
// omitBackground keeps the corners outside the rounded rect transparent.
await tab.screenshot({ path: `${ICONSET}/${MASTER}`, omitBackground: true })
await browser.close()

for (const entry of DOWNSCALES) {
  await copyFile(`${ICONSET}/${MASTER}`, `${ICONSET}/${entry.name}`)
  await run('sips', ['-z', String(entry.size), String(entry.size), `${ICONSET}/${entry.name}`])
}

await run('iconutil', ['-c', 'icns', ICONSET, '-o', ICNS])

console.log(`Wrote ${ICNS}`)
