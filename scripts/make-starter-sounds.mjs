#!/usr/bin/env node
// Generates the starter sound library as small mono WAV files.
//
// These are synthesised here rather than downloaded so the project ships with
// working sounds under its own license and with no network dependency. Run:
//   node scripts/make-starter-sounds.mjs
// then add/refresh the matching `kind: "sound"` entries in library.json.

import { writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/library')
const RATE = 11025

/** 16-bit mono PCM WAV from samples in [-1, 1]. */
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => {
    const clamped = Math.max(-1, Math.min(1, s))
    data.writeInt16LE(Math.round(clamped * 32767), i * 2)
  })
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const build = (seconds, fn) =>
  Array.from({ length: Math.floor(RATE * seconds) }, (_, i) => fn(i / RATE))

/** Fade the tail so nothing ends on a click. */
const decay = (t, seconds, power = 3) => Math.pow(1 - t / seconds, power)

const sounds = {
  // A friendly two-note chirp.
  beep: build(0.3, t => {
    const freq = t < 0.15 ? 880 : 1174
    return Math.sin(2 * Math.PI * freq * t) * 0.5 * decay(t, 0.3, 1.5)
  }),
  // A low descending blip.
  boop: build(0.3, t => Math.sin(2 * Math.PI * (440 - 220 * (t / 0.3)) * t) * 0.5 * decay(t, 0.3, 1.5)),
  // A short percussive pop.
  pop: build(0.12, t => Math.sin(2 * Math.PI * 1600 * t) * 0.6 * decay(t, 0.12, 5)),
}

for (const [name, samples] of Object.entries(sounds)) {
  const file = resolve(outDir, `${name}.wav`)
  await writeFile(file, wav(samples))
  console.log(`wrote ${file} (${(wav(samples).length / 1024).toFixed(1)} KB)`)
}
