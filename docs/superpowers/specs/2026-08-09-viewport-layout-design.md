# Viewport Layout — Design

**Date:** 2026-08-09
**Status:** Approved by user (brainstorming session)
**Builds on:** `docs/superpowers/specs/2026-08-08-game-playground-design.md`

## The problem

Opening the API reference or the "Add sprite" dialog makes the browser window
grow instead of the pane scrolling. The IDE is supposed to be an app shell
pinned to the viewport, with each pane scrolling inside its own box.

## What was actually measured

Probed with Playwright at 1440×900 before any change:

| State | `documentElement.scrollHeight` | Should be |
|---|---|---|
| At rest | **5765** | 900 |
| API reference hidden | **5765** | 900 |
| API reference shown | **5765** | 900 |
| "Add sprite" dialog open | **14871** | 900 |
| After picking a sprite | **14871**, page scrolled to `pageYOffset` 13936 | 900, 0 |

Three facts fell out of this that change the shape of the fix:

1. **The page is already broken at rest.** Hiding the API reference changes
   nothing — 5765 either way. The drawers are not the cause.
2. **Monaco is the thing inflating the baseline.** `.editor` measures 5519px of
   the 5765. `<Editor height="100%">` cannot resolve a percentage against an
   indefinite ancestor, so it falls back to its own measurement, and
   `automaticLayout: true` re-observes and re-inflates.
3. **After picking a sprite the user is left 13936px down the page**, with the
   IDE entirely off-screen. That is the symptom being reported as "the window
   got bigger".

## Root cause

`.ide` is `display: grid` with `height: 100vh`, but its single implicit row is
`auto`-sized, and an auto row's minimum is its **min-content** height. `.panel`
is a grid item, so its automatic minimum (`min-height: auto`) is also
min-content. Neither `.ide` nor `.panel` sets `overflow: hidden`.

So the row is free to grow past the 100vh container, and no descendant ever
receives a *definite* height. Every consequence follows from that one fact:

- `.drawer` and `.sprite-list` already declare `overflow: auto`, but never
  scroll — they are always exactly as tall as their content.
- Monaco's `height="100%"` has nothing to resolve against.
- `.library-controls`' `position: sticky` does nothing, because its scroll
  container never scrolls.

The fix is to make the height chain definite at the root, not to patch panes.

## Design

### 1. One definite height, clamped at the viewport

```css
html, body { height: 100%; overflow: hidden; }
.ide   { height: 100dvh; overflow: hidden; }
.panel { min-height: 0; overflow: hidden; position: relative; }
```

`min-height: 0` on `.panel` is the load-bearing declaration — it is what
removes the min-content floor that lets the grid row outgrow its container.

`100dvh` rather than `100vh` so mobile browser chrome does not clip the bottom
of the shell. `position: relative` establishes the containing block for §3.

Verified: this alone settles Monaco at 653px instead of 5519px.

### 2. Chrome versus slack

```css
.savebar, .toolbar, .tabs, .banner, .stage-frame, .console { flex: none; }
.sprite-list { flex: 1 1 0; min-height: 88px; overflow: auto; }
.code-area { min-height: 0; overflow: hidden; }
.code-main { min-height: 0; }
.code-area > .drawer { flex: none; }
```

`flex: none` on `.stage-frame` fixes a latent second bug: it is `height: 360px`
with a default `flex-shrink: 1`, so on a short window the game stage could be
squashed off-aspect. The runtime draws at fixed coordinates and must never be
scaled.

`.code-area > .drawer` keeps `flex: none` to hold its 320px width. Its *height*
now comes from stretching to a `.code-area` that finally has one, at which
point its pre-existing `overflow: auto` starts working.

### 3. Left-panel dialogs overlay the column

The library dialog cannot live in the space left under a fixed 384px stage —
measured, that is 422px at a 900px viewport (of which the sticky controls block
is 177px, leaving ~245px ≈ 1.5 rows of an 886-item grid) and 142px at 620px,
which is less than the controls block itself.

```css
.panel > .drawer {
  position: absolute; inset: 0; z-index: 2;
  width: auto; padding: 0; border-left: none;
  display: flex; flex-direction: column;
  background: var(--panel);
}
.panel > .drawer > .toolbar { flex: none; }
.drawer-body { flex: 1; min-height: 0; overflow: auto; padding: 12px; }
```

`.panel > .drawer` selects only `LibraryDialog` and `LoadDialog`; `ApiDrawer` is
a child of `.code-area` and is deliberately not matched. This takes the dialog
from 422px to ~810px at a 900px viewport.

`App.tsx` does not change. The dialogs still replace `SpriteList` in the React
tree exactly as they do today — only their painting changes.

The one component change: both dialogs wrap everything below their `.toolbar` in
`<div className="drawer-body">`, so the toolbar and its **Close** button stay
pinned. Without it, Close scrolls out of reach after one flick through a
9818px grid. `.library-controls`' existing `position: sticky` keeps working; it
simply becomes sticky within `.drawer-body`.

`.library-dialog { width: 420px }` and its comment are deleted — the overlay
makes both obsolete.

### 4. Catalog cards stack

Widening the dialog from 420px to the full column is what forced this. At
420px, `repeat(auto-fill, minmax(140px, 1fr))` found two columns of ~194px; at
the overlay's ~496px it finds three of ~160px, and a horizontal card — 48px
thumb, name, and "Use this" — visibly overflowed its own border at that width.

```css
.library-grid .library-entry { flex-direction: column; gap: 6px; margin-bottom: 0; text-align: center; }
.library-grid .library-entry p { flex: none; }
```

Scoped to `.library-grid`, so the built-in list and the Load dialog's recent
games — which reuse `.library-entry` at full width — keep their row layout.

## Testing

New `e2e/layout.spec.ts`, at 1440×900 and 1280×620:

- `documentElement.scrollHeight <= innerHeight` at rest, with the API reference
  shown and hidden, with the library dialog open, with the Load dialog open,
  after adding a sprite, with a long script in the editor, and with many
  console lines.
- Positive assertions that panes scroll *internally*: `scrollHeight >
  clientHeight` on the drawer while the page itself does not move.
- The library dialog's box matches the left panel's box.
- The dialog's toolbar stays at the top of the panel after its body is
  scrolled.
- `.editor` height stays under the viewport (the Monaco regression guard).

Then the full existing `npm test` and `npm run test:e2e`.

## Accepted limits

Below roughly 520px of viewport height the left column cannot fit the savebar,
toolbar, the 384px stage and a usable sprite list. `min-height: 88px` keeps
**+ Add sprite** reachable; below that the panel clips rather than scrolls.
Fixing it properly means scaling or collapsing a fixed-coordinate game canvas,
which is out of scope here.

`overflow: hidden` on `body` means any future element that genuinely overflows
becomes unreachable rather than scrollable. The `e2e/layout.spec.ts` guards are
what make that trade safe.

## Out of scope

Pinning the API reference's search input. It scrolls away up a 5679px list
today and the same `.drawer-body` pattern would fix it, but it is adjacent to
the reported bug rather than part of it.
