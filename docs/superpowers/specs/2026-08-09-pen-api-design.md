# A pen that draws on the stage

**Date:** 2026-08-09
**Status:** approved

## The problem

Scratch's Pen extension is where a lot of kids first make something that feels
like *theirs* rather than like a tutorial: spirographs, turtle drawings, trails
behind a moving sprite, stamped patterns. It is nine blocks and it unlocks a
whole genre of project. We have no equivalent — a sprite can move, but it
leaves nothing behind.

The reason this is not a two-hour job is the architecture. `src/runtime/` is
deliberately framework-free and Phaser-free, and a pen trail is inherently a
rendering artifact that has to survive across frames. Everything the engine
currently produces is a *snapshot of present state*: where each sprite is right
now, which costume, which bubble. A pen trail is the accumulated history of
where sprites have been, which is a different kind of thing, and how it crosses
into Phaser is the whole design.

## The API

Nine names, mapping one-to-one onto Scratch's nine pen blocks.

| Scratch block | Ours |
| --- | --- |
| `pen down` | `sprite.penDown()` |
| `pen up` | `sprite.penUp()` |
| `stamp` | `sprite.stamp()` |
| `set pen color to [#F00]` | `sprite.setPenColor("hotpink")` |
| `set pen size to ()` | `sprite.setPenSize(5)` |
| `change pen size by ()` | `sprite.changePenSize(2)` |
| `set pen (color v) to ()` | `sprite.setPen({ color: 50 })` |
| `change pen (color v) by ()` | `sprite.changePen({ color: 10 })` |
| `erase all` | `eraseAll()` |

Eight are sprite methods because pen state in Scratch belongs to a sprite, not
to the stage. `eraseAll()` is the exception — it wipes the whole pen layer, so
it is a global alongside `broadcast()` and `stopAll()`, and it keeps Scratch's
own wording so a kid migrating can find it by the block name they know.

Scratch's parameter dropdown becomes an options object rather than a
`(name, value)` pair, so several parameters can move at once:

```js
onStart(() => {
  eraseAll()
  sprite.setPenColor("red")
  sprite.setPenSize(3)
  sprite.penDown()
  for (let i = 0; i < 100; i++) {
    sprite.move(5)
    sprite.turnRight(10)
    sprite.changePen({ color: 2 })     // rainbow spiral
  }
})
```

`setPenColor` accepts the full CSS named-color set (`"red"`, `"hotpink"`,
`"rebeccapurple"`) plus `#f00` and `#ff0000`. Whatever color word a kid types
probably works, which is the point.

## Pen state

One `PenState` per sprite, with Scratch's defaults exactly:

| Field | Default | Range |
| --- | --- | --- |
| `down` | `false` | — |
| `color` (hue) | `66.66` → blue | 0–100, **wraps** |
| `saturation` | `100` | 0–100, clamps |
| `brightness` | `100` | 0–100, clamps |
| `transparency` | `0` | 0–100, clamps |
| `size` | `1` | 1–1200, clamps |

Hue wraps and the other three clamp because that is what `scratch-vm` does
(`MathUtil.wrapClamp` vs `MathUtil.clamp`), and the difference is load-bearing:
`changePen({ color: 2 })` in a loop makes a rainbow precisely because hue wraps
past 100 back to 0. `setPen` and `changePen` apply the same wrap/clamp rules —
`changePen` adds to the current value and then normalizes, so it can never
leave the state out of range.

HSB is the stored truth. An RGBA is cached alongside it and recomputed whenever
a parameter changes, so emitting a line segment never costs a color conversion.

`setPenColor("hotpink")` parses to RGB, converts to HSB, and writes all three of
hue/saturation/brightness — so a following `changePen({ color: 10 })` continues
from hot pink rather than from wherever the hue happened to be. It also resets
`transparency` to `0`, matching Scratch. `#rrggbbaa` and `#rgba` are accepted
and set transparency from the alpha; that is four lines in the parser and it is
what Scratch does with an alpha-carrying color.

## How pen output reaches Phaser

`World` grows a `penOps` queue and `snapshot()` drains it, exactly as the
existing `soundQueue` already works. `scene.ts` owns one Phaser `RenderTexture`
and paints each frame's ops into it.

```
sprite.penDown()   → PenState.down = true; PenLayer.dot(x, y, rgba, size)
sprite.move(10)    → SpriteModel.place(nx, ny)
                       → pen down? PenLayer.line(oldX, oldY, nx, ny, rgba, size)
scene.update()     → session.step() → session.snapshot()  (drains penOps)
                   → penLayer.apply(ops) → RenderTexture accumulates
```

Ops are `{kind:'line', x1, y1, x2, y2, rgba, size}`, `{kind:'dot', x, y, rgba,
size}`, `{kind:'stamp', spriteId}`, and `{kind:'clear'}`.

The texture accumulates, so a 20,000-segment spirograph costs one texture
rather than 20,000 draw calls per frame. The engine stays Phaser-free and the
whole pen is unit-testable as plain data: assert on the op list.

The two alternatives were worse. Keeping a retained stroke list in the snapshot
and repainting it every frame is purer — the snapshot stays the whole truth,
with no drain semantics — but it is O(strokes) per frame, the snapshot grows
without bound, and `stamp` cannot be expressed as retained state without
carrying pixel data. Putting the pen entirely in `runtime-host/` needs no
protocol change at all, but it moves Phaser across the layering rule, makes the
pen untestable under vitest's node environment, and means `World` no longer
describes the full runtime state.

### `place()` is the only writer of a sprite's position

Lines hook *movement*, not frames. Sampling position once per tick would
collapse a synchronous `for` loop that draws a square into a single diagonal
line, so every position change has to emit its own segment.

`SpriteModel.x` and `.y` become getters over private fields, and `place(x, y)`
becomes the only writer. That makes it impossible to move a sprite without the
pen noticing; the alternative — remembering to call a hook at each mutation site
— fails silently the first time someone adds a seventh one. Call sites are
`move`, `goTo`, `changeX`, `changeY`, `glide`'s per-frame step, and
`ifOnEdgeBounce`, plus `world.clone()` and `session.ts`'s initial placement.

Those last two are construction, and they are safe by ordering: a fresh
`PenState` is pen-up, so positioning a new sprite emits nothing, and `clone()`
copies the source's pen state *after* placing the clone.

### Clones, stamps, erasing

**`penDown()`** draws a dot at the current position before anything moves, so a
sprite that puts its pen down and stops still leaves a mark. Calling it while
the pen is already down draws another dot at the same spot — harmless, and
what Scratch does.

**Clones inherit pen state**, including `down: true` — Scratch's behavior, and
what makes "clone an army of pens" projects work. The clone's first *move*
starts its line; spawning alone draws nothing.

**`stamp()`** queues `{kind:'stamp', pose}`, where `pose` is a `RenderablePose`
— the sprite's position, direction, size, rotation style, costume and effects,
frozen at the moment of the call. A hidden sprite stamps nothing.

The pose has to travel with the op. Carrying only a sprite id and resolving it
against the live `Phaser.GameObjects.Image` at render time draws the stamp
wherever the sprite *ended* the frame, so a script that stamps and then moves
on leaves its stamp in the wrong place — or, if it moves onto the sprite's
final position, appears to leave no stamp at all. That was implemented the
wrong way first and caught by a screenshot, not by a test.

`RenderablePose` lives in `runtime/spriteModel.ts` and is what `viewFor` takes,
so a stamped pose renders by exactly the same rules a live sprite does; a
snapshot sprite satisfies the shape structurally.

**`eraseAll()`** queues a `clear` op rather than clearing eagerly, so ordering
within a frame is preserved: `eraseAll()` and then drawing, in the same tick,
does the obvious thing.

### Rendering details

The pen layer sits at depth `-500`: above the backdrop's `-1000`, below every
sprite (sprite depths are array indices from `0`) and below the watcher text at
`10000`. That matches Scratch, where the pen layer is above the backdrop and
behind all sprites.

All line and dot ops in a frame batch into one reusable `Graphics` with round
caps and joins — so thick spirographs do not come out spiky — and are drawn
into the `RenderTexture` in a single call. Stamp ops draw individually because
they carry a texture. Stage→Phaser coordinate conversion reuses the existing
`toPhaserX`/`toPhaserY` from `spriteViews.ts`.

**Implementation risk to check early:** Phaser's `RenderTexture.draw(gameObject)`
has historically been inconsistent about honoring rotation and scale versus
needing `drawFrame` with explicit transform arguments. The stamp step needs a
real check against the installed Phaser version at the start of implementation,
not at the end.

### Flood cap

A synchronous loop can emit unboundedly many ops into one frame. `PenLayer`
caps the queue at 10,000 ops per frame and drops the overflow **silently** — no
error, because that frame is already lost to the runaway loop itself, and "too
many pen lines" is noise to a kid who has not yet worked out why their game
froze.

## Modules

Three new files, all small and single-purpose:

| Module | Purpose | Depends on |
| --- | --- | --- |
| `src/runtime/colors.ts` | `parseColor(input) → {r,g,b,a}` for CSS names and hex; `rgbToHsb` / `hsbToRgb` | nothing |
| `src/runtime/pen.ts` | `PenState` (per sprite) and `PenLayer` (op queue, cap, clear) | `colors.ts` |
| `src/runtime-host/penLayer.ts` | Phaser side: owns the `RenderTexture`, applies a frame's ops | Phaser |

Eight touched:

- `spriteModel.ts` — the `place()` funnel, private `x`/`y`, a `pen` field
- `world.ts` — owns the `PenLayer`, drains it in `snapshot()`, copies pen state
  in `clone()`, exposes `eraseAll()`
- `spriteApi.ts` — the eight sprite methods
- `executor.ts` — the `eraseAll` global
- `session.ts` — initial placement goes through `place()`
- `shared/apiDefs.ts` — nine defs under a new `'Pen'` category
- `ide/reference.ts` — `'Pen'` inserted into `CATEGORY_ORDER` after `'Looks'`
- `runtime-host/scene.ts` — mounts the pen layer, feeds it each frame

## What does not change

- **`shared/protocol.ts`.** The snapshot never crosses the iframe boundary —
  `scene.ts` calls `session.snapshot()` from *inside* the iframe. `RunPayload`
  and the `HostMessage` union are untouched.
- **The project document.** Pen state is runtime-only: no `projectSchema.ts`
  edit, no `version` bump. A saved game with pen code is just a saved game with
  source strings in it, like every other game.
- **The IDE.** No new panel and no new component. Nine entries in `apiDefs.ts`
  flow automatically into the reference drawer, Monaco autocomplete, and the
  docs.

## Errors

In the established `errors.ts` voice:

```
`setPenColor` needs some text in quotes, like `sprite.setPenColor("red")` — you gave it 5.

`setPenColor` doesn't know the color "blurple". Try a color name like "red",
"hotpink" or "skyblue", or a hex code like "#ff0000".

`setPen` needs a list of pen settings, like `sprite.setPen({ color: 50 })` — you gave it 5.

`setPen` needs at least one pen setting, like `sprite.setPen({ color: 50 })`.

`setPen` doesn't know the pen setting "colour". You can set "color", "saturation",
"brightness" and "transparency".

`setPen` changes the pen's colors — to change how thick it is, use `sprite.setPenSize(5)`.
```

That last one fires on `setPen({ size: 5 })`. It is not a typo, it is a genuine
API confusion — `size` is the one pen property that is *not* in the settings
object — and a kid who hits it has the right mental model and a wrong guess
about where it lives. Every numeric argument goes through the existing
`expectNumber`, so `setPen({ color: "a lot" })` and `setPenSize("big")` report
themselves without new message-writing.

## Testing

**Unit (vitest, node)** carries correctness, because the op stream is pure data:

- `colors.test.ts` — named colors, 3/6/8-digit hex, case-insensitivity,
  rejections; RGB↔HSB round-trips; the black/grayscale edge where hue is
  meaningless.
- `pen.test.ts` — defaults; hue wraps past 100 while saturation, brightness and
  transparency clamp; size clamps to 1–1200; the 10,000-op cap drops overflow.
- `spriteModel.test.ts` — `penDown()` emits a dot; each of the six motion paths
  emits a segment while down and nothing while up; a segment's start point
  equals the position before the move; `glide` emits one segment per frame
  rather than one for the whole glide.
- `world.test.ts` — `snapshot()` drains `penOps` exactly once (second call
  empty, the contract the sounds queue is already tested for); a clone inherits
  pen state; a clone's spawn emits nothing; `eraseAll()` queues a clear rather
  than clearing eagerly.
- `apiDefs.test.ts` and `reference.test.ts` already guard def↔implementation
  pairing and category coverage, so the nine defs and the new category are
  covered by tests that exist.

**E2E (Playwright)** follows the console-not-pixels precedent set at
`ide.spec.ts:79` ("the watcher itself is drawn inside the canvas, so assert on
the shared [console] instead"): one spec runs a script exercising all nine APIs,
asserts the canvas is visible and **zero script issues** are reported, then
`console.log`s the sprite's position after a drawing loop to prove the
motion/pen interplay actually executed in a real browser.

**No pixel assertions**, and this is a real gap worth naming: *"the trail is
actually visible on the stage"* is verified manually, not automatically. Phaser
runs `Phaser.AUTO`, so canvas readback needs either `preserveDrawingBuffer` — a
production config change made for a test — or committed screenshot baselines,
which are GPU- and OS-dependent and would have to hold across all three e2e
modes. See the TODO note below for the way in, if we want it later.

## Deferred — to be recorded in `docs/TODO.md` with the implementation

- **Stop wipes the drawing.** Scratch keeps pen trails on the stage after the
  red octagon; our Stop unmounts the iframe, so the trail goes with it, the same
  way sprites already do. Making trails survive would mean lifting the pen
  texture out of the iframe and trading away the clean-slate-per-Run guarantee.
- **No automated pixel verification.** If we want it, Phaser's
  `RenderTexture.snapshotPixel()` reads from the render texture's own
  framebuffer and sidesteps the drawing-buffer problem entirely — it needs only
  a dev-only handle on the pen layer.
- **The 10,000-op frame cap is silent.** Deliberate, but it means a pathological
  project draws less than it asked for with no signal.
- **Pen lines start at the sprite's centre.** `docs/TODO.md` already records
  that Scratch's `rotationCenterX/Y` is ignored because our engine is
  centre-anchored. A pen makes that existing divergence more visible: a Scratch
  turtle costume whose rotation centre is at its nose draws from its middle
  instead. Same root cause, no new work — recorded so nobody debugs it twice.
