# 2D Game Playground — Design

**Date:** 2026-08-08
**Status:** Approved by user (brainstorming session)

## What we're building

A web-based playground where kids and beginners create 2D games by writing JavaScript — Scratch's stage, sprites, and event model, but with real code instead of blocks. The stage lives on the left, the code editor on the right. Games save to a server and open on any device via a private link.

**Audience:** kids/beginners learning JavaScript. Every design choice favors forgiveness and clarity over power.

## Decisions made

| Decision | Choice |
|---|---|
| Rendering engine | Phaser, fully hidden behind a Scratch-like wrapper API |
| IDE stack | React + TypeScript + Vite; Monaco editor |
| Code model | One `main` script + one script per sprite |
| User code isolation | Sandboxed iframe, destroyed on Stop |
| Persistence | Server-side (Node + Fastify + SQLite); no accounts — private secret links |
| Assets | Built-in library + image/sound upload (data URLs in v1) |
| API discoverability | Generated API reference panel + Monaco autocomplete from one source of truth |
| Deferred (see docs/TODO.md) | File export/import, costume editor, accounts, Playwright e2e |

## Architecture

```
┌─────────────────────────── React IDE shell ───────────────────────────┐
│ ┌──────── Stage panel ────────┐  ┌──────── Code panel ─────────────┐  │
│ │ ▶ Run (green flag) ■ Stop   │  │ tabs: [main] [Cat] [Bat] ...    │  │
│ │ ┌─────────────────────────┐ │  │ ┌─────────────────────────────┐ │  │
│ │ │  sandboxed <iframe>     │ │  │ │  Monaco editor              │ │  │
│ │ │  Phaser stage 480×360   │ │  │ │                             │ │  │
│ │ └─────────────────────────┘ │  │ └─────────────────────────────┘ │  │
│ │ sprite list (thumbnails)    │  │ API reference │ console pane    │  │
│ └─────────────────────────────┘  └─────────────────────────────────┘  │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ REST (create / load / update project)
                     ┌─────────┴─────────┐
                     │ Node + Fastify    │  serves built frontend too
                     │ SQLite            │
                     └───────────────────┘
```

1. **User code runs inside a sandboxed iframe** that also hosts the Phaser canvas. Run serializes the project (scripts + assets) and posts it into a fresh iframe; Stop destroys the iframe. Rationale: beginners write `while (true)` — a runaway loop can't freeze the editor, Stop always works, and every Run is a clean-slate restart like Scratch's green flag.
2. **The wrapper API is the only surface users see.** Inside the iframe, a runtime layer creates Phaser scenes/sprites and exposes Scratch-shaped globals. Phaser is an implementation detail: the save format and docs never mention it, so the engine can be swapped without breaking saved games.
3. **Code model:** per-sprite scripts get their sprite as an implicit global (`sprite`); `main` can access every sprite by name for game-wide logic (score, win conditions) and declares shared variables.

## The Scratch-like JavaScript API

Users write event handlers, mirroring Scratch scripts hanging off hat blocks:

```js
// Cat's script
onStart(async () => {            // ⚑ "when green flag clicked"
  sprite.goTo(0, 0);
  await sprite.say("Hello!", 2); // say with bubble for 2 seconds
});

onKeyPress("right", () => sprite.changeX(10));

onClick(async () => {            // "when this sprite clicked"
  await sprite.glide(100, 100, 1);
  broadcast("caught");
});
```

API groups map one-to-one to Scratch's block categories:

- **Motion** — `move(steps)`, `turnRight/Left(deg)`, `goTo(x, y)`, `changeX/Y(n)`, `glide(x, y, secs)`, `pointInDirection(deg)`, `pointTowards(target)`, `setRotationStyle(style)`, `ifOnEdgeBounce()`; `x`/`y`/`direction` properties. Scratch coordinates: (0,0) at stage center, 480×360, +y up.
- **Looks** — `say(text, secs?)`, `think(text, secs?)`, `switchCostume(name)`, `nextCostume()`, `setSize(percent)`, `show()`/`hide()`, `setEffect(name, value)` (ghost, brightness…), `goToFront()`/`goBack(n)`.
- **Sound** — `playSound(name)`, `playSoundUntilDone(name)`, `setVolume(n)`.
- **Events** — `onStart(fn)`, `onKeyPress(key, fn)`, `onClick(fn)`, `onMessage(name, fn)` + `broadcast(name)`, `onBackdropSwitch(name, fn)`, `onUpdate(fn)` (every frame — the safe replacement for `forever`).
- **Sensing** — `touching(spriteOrEdge)`, `distanceTo(target)`, `mouse.x/y/isDown`, `keyIsDown(key)`, `timer` + `resetTimer()`.
- **Control** — `wait(secs)`, `clone()` + `onCloneStart(fn)` + `deleteClone()`, `stopAll()`.
- **Stage** — `stage.switchBackdrop(name)`, `stage.nextBackdrop()`.
- **Variables** — plain JavaScript variables; `main` declares shared ones. `watch("score")` shows a Scratch-style readout on stage.

**Timing model:** anything that takes time (`glide`, `wait`, timed `say`, `playSoundUntilDone`) returns a Promise; users write `await`. One rule, taught once — sequential scripts read like Scratch stacks. Handlers run concurrently, like multiple Scratch scripts.

**Single source of truth for the API:** each function is defined once with signature, kid-friendly description, and a runnable example. The runtime, Monaco autocomplete, and the API reference panel are all generated from these definitions, so docs can never drift from behavior.

**Beginner safety:** every API call validates arguments and throws messages written for kids ("`move` needs a number, like `sprite.move(10)` — you gave it `\"fast\"`"), surfaced in the console pane with sprite name and line number.

## IDE layout & features

**Left panel** (top to bottom, mirroring Scratch): Run ▶ / Stop ■ toolbar → stage (the sandboxed iframe, 480×360 logical, scaled to fit) → sprite list (thumbnails; click selects the sprite and opens its code tab; add from library or upload, rename, delete; separate stage/backdrop entry).

**Right panel:**
- **Tabs** — `main` plus one per sprite; Monaco with autocomplete fed by the API definitions.
- **API Reference panel** — toggleable drawer organized by Scratch categories, searchable; each entry shows signature + one-line description + copy-paste example, with an "insert at cursor" button.
- **Console pane** — `console.log` output and friendly errors, tagged with sprite and line.

**Assets:** library dialog (curated sprites with costumes, backdrops, sounds); upload PNG/JPG (costumes/backdrops) and MP3/WAV (sounds), embedded as data URLs with downscaling to ≤480×360 on import and a 10 MB per-project size cap (enforced client-side at upload and server-side at save).

**Top bar:** project name, Save, Load (recent games list + open-by-link).

## Save format & persistence

One JSON document per project — same shape in transit, in SQLite, and in any future backend evolution:

```json
{
  "version": 1,
  "name": "Cat Chase",
  "sprites": [
    {
      "name": "Cat",
      "x": 0, "y": 0, "size": 100, "direction": 90, "visible": true,
      "costumes": [{ "name": "cat-a", "source": "library:cat-a" }],
      "currentCostume": 0,
      "script": "onStart(async () => { ... })"
    }
  ],
  "stage": {
    "backdrops": [{ "name": "blue-sky", "source": "library:blue-sky" }],
    "currentBackdrop": 0
  },
  "sounds": [{ "name": "meow", "source": "library:meow" }],
  "mainScript": "let score = 0; watch('score'); ..."
}
```

- **Asset references:** `library:<id>` for built-ins (keeps saves tiny); `data:` URLs for uploads. If uploads later move to real asset storage, only the `source` value changes.
- **Backend:** Node + Fastify + SQLite, one deployable that also serves the built frontend. Three endpoints: create project → `{ id }`, load by id, update by id.
- **Access model — secret links, no accounts:** the project id is a random unguessable token; the edit URL (`/p/<id>`) *is* the key, like a private doc link. Anyone with the URL can open and edit. The browser keeps a local recent-games list; after first save the app prominently prompts "copy your game link." **Accepted trade-off:** losing the link loses the game. Accounts can layer on later without changing the save format.
- **`version` field** from day one for future migrations.
- **Scripts are stored as plain source strings** — compiled fresh in the iframe on every Run; nothing executable is persisted.

## Error handling

- **Syntax errors:** Monaco squiggles before Run; running broken code shows a friendly message naming the tab and line — never a raw stack trace.
- **Runtime errors:** caught per-handler in the iframe, so one sprite's crash doesn't stop the others; console shows "In **Cat**, line 3: …" and the game keeps running.
- **Server errors:** plain-language banner; project stays in memory so nothing is lost; retry is manual and obvious.

## Testing

- **Vitest** unit tests for the API wrapper — the core surface: timing (`glide` resolves after its duration), sensing (`touching` detects overlap), validation (friendly messages) — using Phaser's headless mode.
- **Vitest** tests for server endpoints (`server/app.test.ts`) against in-memory SQLite: id generation, the store, project validation and the size cap, all three endpoints including 400/404/413, static serving with both required headers and the SPA fallback.
- Light component tests for the React shell only where logic lives (save flow, tab switching).
- **Playwright end-to-end** (`e2e/`): drives the real IDE in Chromium — add a sprite, edit code, Run, assert on stage/console, Stop, clones, sounds, backdrops, library-failure recovery. This layer caught bugs the unit tests structurally could not (the sandboxed iframe's CORS failure, unrunnable `await` examples).
- The e2e suite runs in three modes (`playwright.config.ts`): against the Vite dev server (default), the production preview build (`E2E_PREVIEW=1`), and the real Fastify server (`E2E_SERVER=1`, `npm run test:e2e:server` / `make test-e2e-server`) — the last builds the client, runs `server/index.ts` with `DB_FILE` pointed at a disposable SQLite file, and is the only mode that exercises the actual save/load round trip: `e2e/save-load.spec.ts` saves a game, opens its link in a fresh browser context to prove the link (not local storage) carries it, and covers updating an existing save, the on-device recent-games list, an unknown link's 404, and pasting a link into the Load dialog. All three modes run the same 22 core IDE tests plus, in server mode, the 5 save/load tests.

## Phasing

- **v1 (this spec):** engine wrapper + IDE + API reference + library/upload assets + server saves with secret links.
- **Phase 2:** costume editor (a costume is just an image the project owns, so it slots in without format changes).
- **Phase 3:** accounts and sharing, if wanted — layered onto the same save format.
