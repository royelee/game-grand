# Managing backdrops and sounds, the way sprites are managed

**Date:** 2026-08-09
**Status:** approved

## The problem

Backdrops and sounds are already real project data — `project.stage.backdrops`
(with `currentBackdrop`) and `project.sounds` — and they already persist. What
is missing is any way to *see* them.

The left panel is `SaveBar → toolbar → stage → SpriteList`. The `Backdrop` and
`Sounds` toolbar buttons open `LibraryDialog`, which overlays the whole column
(`.panel > .drawer { position: absolute; inset: 0 }`). Picking dispatches
`add-backdrop`/`add-sound` and then `setPicking(null)`, so the dialog collapses
back to the sprite list and the thing that was just added is invisible. There is
no way to tell what a project contains, no way to remove a mistake, and no way
to change which backdrop the game starts on.

Names are not cosmetic here. Scripts address these assets by name —
`stage.switchBackdrop("night")`, `playSound("meow")` — and Scratch names arrive
verbatim (`Neon Tunnel`, `Water drop2`), so being unable to read or change them
is a functional gap, not a tidiness one.

## The shape of the fix

`SpriteList` becomes `AssetPanel`: a tab bar over one list.

```
┌─ Stage 480×360 ───────────────┐
│                               │
└───────────────────────────────┘
┌───────────────────────────────┐
│ [Sprites] [Backdrops] [Sounds]│
│                               │
│ 🌌 Night        ✓ Starts here │
│      [Rename] [Delete]        │
│ 🏙 Colorful City              │
│  [Start here][Rename][Delete] │
│                               │
│ [+ Add backdrop]              │
└───────────────────────────────┘
```

| Tab | Row | Actions |
| --- | --- | --- |
| Sprites | thumbnail + name | Rename, Delete (unchanged; clicking the row selects its code tab) |
| Backdrops | thumbnail + name, `✓ Starts here` on the current one | Start here, Rename, Delete |
| Sounds | `▶ Play` + name | Rename, Delete |

The toolbar's `Backdrop` and `Sounds` buttons are removed. Adding happens from
the active tab's `+ Add backdrop` / `+ Add sound`, which opens the same
`LibraryDialog` as before.

Tabs rather than three stacked sections because vertical space is tight: the
stage is a fixed 384px, leaving roughly 420px for the list at a 900px viewport.
One list at a time gets all of it.

### "Starts here", not "showing"

`currentBackdrop` is labelled **Starts here**, with a **Start here** button on
the other rows. The IDE stage only renders during a run, so "Show" would promise
a live preview that does not exist. What the field actually means is which
backdrop the game opens on.

Adding a backdrop continues to make it current, as `addBackdrop` does today.
The difference is that the choice is now visible and reversible.

### The dialog overlays the panel instead of replacing the list

Today `App` renders the dialog and the sprite list as alternatives in a ternary,
so the list unmounts while the dialog is open. `AssetPanel` will render
unconditionally, with the dialogs layered on top — which is what the CSS already
assumes. The consequence that matters: the tab you were on survives the round
trip, so picking a backdrop drops you back on the Backdrops tab with the new row
visible. That visible landing is the whole point of the feature.

## Project-layer operations

New pure helpers in `src/shared/project.ts`, alongside the existing
`addBackdrop`/`addSound`:

```ts
setCurrentBackdrop(project, index): Project
renameBackdrop(project, index, to): Project   // throws if another backdrop has that name
deleteBackdrop(project, index): Project       // throws if it is the only one
renameSound(project, index, to): Project      // throws if another sound has that name
deleteSound(project, index): Project
```

**Addressed by index, not by name.** `validateProject` enforces unique *sprite*
names but never checks backdrop or sound names (`projectSchema.ts:106-131`), so
a stored document can legitimately hold two backdrops called the same thing.
Addressing by name would be ambiguous on exactly the projects that most need
fixing.

**Deleting the only backdrop is refused.** The schema requires at least one
(`projectSchema.ts:120`). The UI disables the button and explains why; the
helper throws as a backstop.

**The current-backdrop pointer is kept valid.** With `d` deleted and `c`
current, the new current is:

| Case | New current |
| --- | --- |
| `d < c` | `c - 1` |
| `d === c` | `min(d, backdrops.length - 2)` — whatever slid into the slot, or the new last row |
| `d > c` | `c` |

**Rename collisions throw** a friendly message, mirroring `renameSprite`. The
reducer already catches those and prints them to the console
(`store.ts:108-116`), so the behaviour is consistent with what sprites do.

## Warning before a rename or delete breaks code

New module `src/ide/references.ts`:

```ts
/** Tab names whose script contains `name` as a quoted literal. */
export function scriptsReferencing(project: Project, name: string): string[]
```

A plain substring search for `"name"` and `'name'` across `mainScript` and every
sprite script. No regex, so a name containing quotes or regex metacharacters
needs no escaping.

`App` uses it to build the confirmation:

> Your code uses "meow" in main and Cat. Delete it anyway?

The same check runs on rename. Nothing rewrites code — a blind string replace
would hit unrelated text such as `say("meow")`, and editing code the kid did not
touch is worse than a warning.

This is deliberately a heads-up, not a guarantee: template literals and computed
names will not match. The code comment says so rather than overclaiming.

`window.confirm`/`window.prompt` already carry the existing sprite rename and
unsaved-work flows, so these dialogs live in `App` and the list components stay
presentational.

## Components

- `AssetPanel.tsx` — owns the active-tab state, renders the tab bar and one list
- `SpriteList.tsx` — as today, minus its own heading
- `BackdropList.tsx` — new
- `SoundList.tsx` — new
- `App.tsx` — `costumeUrl` becomes `assetUrl` (sound preview needs it too), the
  two toolbar buttons go, and the confirm/prompt flows are added

Rejected: one component with branches, and a config-driven generic `AssetList`.
The three rows genuinely differ — a sprite click selects a code tab, a backdrop
carries a current-marker, a sound plays audio — so a generic version's config
would be almost entirely callbacks, hiding the differences without removing them.

### Reducer

Five new actions in `src/ide/store.ts`, each carrying an `index` (renames also
carry `to`):

`set-current-backdrop`, `rename-backdrop`, `delete-backdrop`, `rename-sound`,
`delete-sound`

All five join `EDITING_ACTIONS`, so a `saved` badge correctly drops to `idle`
once the project no longer matches what is on the server. Rename and delete are
wrapped in try/catch and surface a thrown message as a console issue, exactly as
`rename-sprite` does.

## Testing

**Unit**

- `project.test.ts` — the current-backdrop pointer arithmetic for each delete
  case, refusing to delete the only backdrop, rename collisions
- `references.test.ts` — quoted-literal matching in both quote styles, no false
  hit on `sayMeow`, correct tab names returned
- `store.test.ts` — each action edits the project and drops `saved` to `idle`; a
  colliding rename logs an issue and leaves the project untouched

**End to end**

- Add two backdrops, change which one starts, Run, and confirm the stage shows
  the chosen one
- Delete a sound a script references, accept the confirmation, Run, and confirm
  the friendly missing-sound error appears

**Existing tests that must change**

- `chooseBackdrop` in `e2e/helpers.ts` — Backdrops tab, then `+ Add backdrop`
- The three `getByRole('button', { name: 'Sounds' })` call sites in
  `ide.spec.ts`
- Sound-preview selectors get scoped to the list, since `▶ Play` will now exist
  in both the list and the library dialog

## Out of scope

**Sprite costumes.** A Scratch sprite such as `Cat` arrives with several
costumes (`cat-a`, `cat-b`), `sprite.switchCostume("cat-b")` is in the API
reference, and nothing shows those names — the same class of problem. Fixing it
needs a new "add a costume to an existing sprite" action (`setPicking('costume')`
currently creates a whole new sprite, `App.tsx:154`), a nested list, and a
"a sprite must keep at least one costume" rule. Logged in `docs/TODO.md` as the
follow-up.

**Reordering.** `stage.nextBackdrop()` walks the list in order, so drag-to-
reorder has a real use, but no one has asked for it and every other list in the
app is append-only.
