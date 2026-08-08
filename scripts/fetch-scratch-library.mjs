#!/usr/bin/env node
// Optional: enrich public/library/ with assets from the Scratch media library.
// Scratch library media is CC BY-SA 4.0 — see public/library/LICENSE.md and
// docs/sprite_libraries.md before shipping what this downloads.
//
// Usage: node scripts/fetch-scratch-library.mjs <md5ext> <id> <kind> <label>
//   e.g. node scripts/fetch-scratch-library.mjs b7853f557e4426412e64bb3da6531a99.svg scratch-cat costume "Scratch Cat"
// Appends the entry to library.json (dimensions are read from the SVG header,
// or pass --width/--height for bitmaps).

import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const libDir = resolve(root, 'public/library')
const CDN = 'https://assets.scratch.mit.edu/internalapi/asset'

const [md5ext, id, kind, label] = process.argv.slice(2)
if (!md5ext || !id || !kind || !label) {
  console.error('usage: fetch-scratch-library.mjs <md5ext> <id> <kind> <label> [--width N --height N]')
  process.exit(1)
}

const flag = name => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : Number(process.argv[i + 1])
}

const res = await fetch(`${CDN}/${md5ext}/get/`)
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`)
  process.exit(1)
}
const bytes = Buffer.from(await res.arrayBuffer())
const file = `${id}${md5ext.slice(md5ext.lastIndexOf('.'))}`
await writeFile(resolve(libDir, file), bytes)

let width = flag('width')
let height = flag('height')
if (width === null || height === null) {
  const head = bytes.toString('utf8', 0, 400)
  width = Number(head.match(/width="([\d.]+)/)?.[1] ?? 0) || null
  height = Number(head.match(/height="([\d.]+)/)?.[1] ?? 0) || null
}
if (!width || !height) {
  console.error('Could not determine dimensions — pass --width and --height.')
  process.exit(1)
}

const manifestPath = resolve(libDir, 'library.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.entries = manifest.entries.filter(e => e.id !== id)
manifest.entries.push({ id, kind, label, file, width, height })
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Added ${id} (${width}×${height}) → ${file}`)
console.log('Reminder: Scratch assets are CC BY-SA 4.0 — keep the attribution.')
