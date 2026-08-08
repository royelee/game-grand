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
    — every library sprite with its costumes (name, `md5ext`, bitmap/vector,
    width/height, rotation center) and attached sounds
  - `backdrops.json`, `costumes.json`, `sounds.json` — same shape, per type
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

## Suggested bootstrap approach (when Plan 2 builds the library)

1. Write a one-off script that reads `sprites.json` / `backdrops.json` /
   `sounds.json`, picks our curated subset (a couple dozen sprites, ~10
   backdrops, ~10 sounds), and downloads the referenced `md5ext` files from
   the CDN into `public/library/scratch/`.
2. Emit our own `library.json` in the app's shape: `{ sprites: [{ name,
   costumes: [{ name, source: "library:<id>", width, height }] }], … }` —
   the catalogs already carry the costume dimensions the engine's
   `Costume.width/height` fields need.
3. Check the downloaded subset into the repo (it is small and versioned) so
   builds don't depend on the Scratch CDN.
4. Include the attribution + CC BY-SA 4.0 notice in the same directory and in
   the library dialog UI.

The `library:<id>` save-format convention in the design spec is unaffected —
this document only determines what populates the library.

Sources:
- [scratch-gui sprites.json](https://github.com/scratchfoundation/scratch-gui/blob/develop/src/lib/libraries/sprites.json)
- [Scratch Wiki — Libraries](https://en.scratch-wiki.info/wiki/Libraries)
- [Scratch Wiki — List of Sprite Library Sprites](https://en.scratch-wiki.info/wiki/List_of_Sprite_Library_Sprites)
- [Scratch forum — CC license on library assets](https://scratch.mit.edu/discuss/topic/783033/)
