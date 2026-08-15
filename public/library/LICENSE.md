# Library assets

The starter assets in this directory (`cat-a`, `cat-b`, `ball`, `bat`, `star`,
`blue-sky`, `night`, `beep`, `boop`, `pop`) were authored for this project —
they are a few hundred bytes of SVG primitives each, not traced from anyone
else's art — and are **MIT licensed**, the same as the rest of the project
(see `LICENSE` at the repository root). They are bundled with the app and work
offline.

`scratch-catalog.json` is **generated, not distributed with this repository**
(`make catalog`, or `npm run catalog`). It contains asset **names, tags, and
MD5 identifiers only** — no asset bytes.

It is left out of the repository on purpose. `scripts/build-scratch-catalog.ts`
derives it from `src/lib/libraries/*.json` inside
[scratch-gui](https://github.com/scratchfoundation/scratch-gui), which is
licensed **AGPL-3.0**. Generating the file locally rather than committing it
keeps this project from redistributing AGPL-derived data, so this project's own
license stays unentangled. Anyone who runs the generator receives that data
from the Scratch Foundation under AGPL-3.0, not from us.

The media the catalog points at is served from `assets.scratch.mit.edu` at
runtime and is licensed **CC BY-SA 4.0**
(https://creativecommons.org/licenses/by-sa/4.0/). This project never
redistributes those bytes either — the browser fetches them from Scratch's CDN
as a project uses them. The app credits the Scratch project in the library
dialog, as that license requires. See `docs/sprite_libraries.md`.

"Scratch" is a trademark of the Scratch Foundation. This project is not
affiliated with or endorsed by them.
