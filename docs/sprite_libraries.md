# Sprite Libraries — bootstrapping from Scratch assets

Supplementary information for the built-in asset library (see the design spec's
"IDE layout & features" section). Our curated library of sprites, backdrops,
and sounds does not need to be drawn from scratch — the Scratch project's own
media library is openly licensed and machine-readable, so v1 can bootstrap
directly from it.

## Where the assets live

- **Catalogs (metadata):** the official Scratch editor repo
  [`scratchfoundation/scratch-gui`](https://github.com/scratchfoundation/scratch-gui)
  contains JSON catalogs under `src/lib/libraries/`:
  - [`sprites.json`](https://github.com/scratchfoundation/scratch-gui/blob/develop/src/lib/libraries/sprites.json)
    — every library sprite with its costumes and attached sounds
  - `backdrops.json`, `costumes.json`, `sounds.json` — same shape, per type

  A costume entry looks like this — note what it does **not** contain:

  ```json
  {
    "assetId": "809d9b47347a6af2860e7a3a35bce057",
    "name": "abby-a",
    "bitmapResolution": 1,
    "md5ext": "809d9b47347a6af2860e7a3a35bce057.svg",
    "dataFormat": "svg",
    "rotationCenterX": 31,
    "rotationCenterY": 100
  }
  ```

  **There is no width/height.** Scratch derives a costume's size by decoding
  the asset itself at load time, dividing by `bitmapResolution` (a PNG with
  `bitmapResolution: 2` is retina art that renders at half its pixel size).
  The catalog entry is pure identity plus rendering metadata.

  The design principle worth copying: **an asset reference identifies an
  asset; it does not describe it.** Dimensions belong to the loaded asset,
  not to the reference stored in a project. A reference that carries a
  cached width can disagree with the file it points at; one that doesn't,
  can't.

  `rotationCenterX/Y` is the anchor point Scratch rotates and positions a
  costume around. Our engine assumes centre-anchored costumes, so importing
  a Scratch costume whose rotation centre is off-centre will position it
  slightly differently than Scratch does — acceptable for v1, worth
  remembering if sprites ever look mis-anchored.
- **Asset files (media):** each catalog entry's `md5ext` (e.g.
  `abc123….svg`) downloads from the Scratch CDN:
  `https://assets.scratch.mit.edu/internalapi/asset/<md5ext>/get/`
- Costumes are SVG (vector) or PNG (bitmap); sounds are WAV/MP3.

## License — CC BY-SA 4.0 (obligations apply)

Scratch's library media is licensed
[Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
(see the [Scratch Wiki on libraries](https://en.scratch-wiki.info/wiki/Libraries)
and the [Scratch FAQ discussion](https://scratch.mit.edu/discuss/topic/783033/)).
Using these assets requires us to:

1. **Attribute** — credit the Scratch project as the source of the bundled
   assets, visibly in the app (e.g. in the library dialog footer and/or an
   About/credits page).
2. **ShareAlike** — the asset files we redistribute (and any modified versions
   of them) stay under CC BY-SA 4.0. This applies to the *assets*, not to our
   application code.

Practical consequence: keep bundled Scratch-derived assets in a clearly
separated directory (e.g. `public/library/scratch/`) with a `LICENSE` file
noting CC BY-SA 4.0 and the attribution line, so their license never blurs
into the codebase's.

As built, we redistribute **no** Scratch asset bytes at all — the browser
fetches them from Scratch's own CDN — so ShareAlike never attaches to anything
in this repo. The attribution obligation still applies, and is met in the
library dialog and `public/library/LICENSE.md`.

## What we actually built

Design spec: `docs/superpowers/specs/2026-08-09-scratch-library-import-design.md`.

The whole library is available, not a curated subset — 339 sprites, 886
costumes, 85 backdrops, 353 sounds, pointing at 1,331 distinct assets.

1. **A checked-in catalog, no bundled bytes.**
   `scripts/build-scratch-catalog.ts` reads the four catalogs above from a
   **pinned scratch-gui commit** (not `develop`, so regeneration is
   reproducible) and writes `public/library/scratch-catalog.json` — names,
   tags, `md5ext`, `bitmapResolution`, and sound durations. Stripping
   Scratch's `blocks`/`variables` takes it from 540 KB to 278 KB (73 KB
   gzipped). It downloads no asset bytes at all. Re-run it to pick up newly
   added Scratch assets.

2. **Assets fetch from the CDN at runtime**, only when a project uses one, via
   `src/ide/scratchAssets.ts`. The CDN sends `access-control-allow-origin: *`
   and a year-long `max-age` on content-addressed URLs, so the browser caches
   each asset and the URL can never go stale.

3. **Dimensions are measured in the browser**, not stored in the catalog —
   exactly as the section above argues they should be. The decoded image's
   natural size is divided by `bitmapResolution` (a `res: 2` PNG is retina:
   `Arctic` is 960×720 and renders at 480×360), then capped to the stage by
   the same `downscale` uploads use.

4. **Attribution** lives in the library dialog footer and in
   `public/library/LICENSE.md`, as CC BY-SA 4.0 requires.

The save format grew one convention: built-ins stay `library:<id>`, and Scratch
assets are `scratch:<md5ext>`. Because that ref names the bytes rather than a
catalog slot, regenerating the catalog can never break an existing saved game.

**Trade-offs accepted** (tracked in `docs/TODO.md`): a saved game depends on
MIT continuing to serve that endpoint, and every player's IP is exposed to
`scratch.mit.edu`. When the CDN is unreachable the app still starts, the
bundled ten still work, and the failure surfaces as a message rather than a
crash.

Sources:
- [scratch-gui sprites.json](https://github.com/scratchfoundation/scratch-gui/blob/develop/src/lib/libraries/sprites.json)
- [Scratch Wiki — Libraries](https://en.scratch-wiki.info/wiki/Libraries)
- [Scratch Wiki — List of Sprite Library Sprites](https://en.scratch-wiki.info/wiki/List_of_Sprite_Library_Sprites)
- [Scratch forum — CC license on library assets](https://scratch.mit.edu/discuss/topic/783033/)
