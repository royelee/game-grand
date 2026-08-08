# Runtime Engine Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-TypeScript Scratch-like runtime engine — sprite model, clock, events, sensing, world, and user-code executor — fully unit-tested, with no Phaser or React involved yet.

**Architecture:** The engine is a headless simulation: a `World` owns `SpriteModel`s, a tickable `Clock`, and an `EventBus`; an `Executor` compiles user script strings and wires them to Scratch-shaped globals. A renderer (Plan 2) will drive `world.tick(dt)` and draw `world.snapshot()`. Everything here runs and tests in Node.

**Tech Stack:** TypeScript, Vite (scaffold only), Vitest. No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-08-game-playground-design.md`
Plans 2 (IDE frontend) and 3 (server) will be written after this plan executes.

## Global Constraints

- Stage is 480×360; coordinates are Scratch-style: (0,0) at center, x ∈ [-240, 240], y ∈ [-180, 180], **+y is up**.
- Direction is Scratch-style degrees: 90 = right, 0 = up, wrapped to (-180, 180].
- All durations are in **seconds**. All sizes are percentages (100 = normal).
- Error messages follow the kid-friendly formula: backticked function name + what it needs + a copy-paste example + what they gave: `` `move` needs a number, like `sprite.move(10)` — you gave it "fast". ``
- Shared game state lives on the injected `vars` object (`vars.score = 0`); `watch("score")` reads `vars.score`. (Refinement of the spec's Variables section: scripts are separate compiled functions, so bare `let` cannot cross scripts.)
- TDD every task: failing test → implement → pass → commit. One commit per task minimum.
- No Phaser, React rendering, or network code in this plan. `src/runtime/**` must import nothing from outside `src/runtime` and `src/shared`.

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html, .gitignore
src/main.tsx, src/App.tsx          # placeholder shell (Plan 2 replaces)
src/shared/apiDefs.ts              # single source of truth for the user API (Task 9)
src/runtime/errors.ts              # FriendlyError + argument validators (Task 2)
src/runtime/clock.ts               # tickable time source (Task 3)
src/runtime/spriteModel.ts         # sprite state: motion (Task 4) + looks (Task 5)
src/runtime/stageModel.ts          # backdrops (Task 5)
src/runtime/eventBus.ts            # handler registry + safe dispatch (Task 6)
src/runtime/sensing.ts             # bounds, touching, distance (Task 6)
src/runtime/world.ts               # owns everything; input, clones, sounds, snapshot (Task 7)
src/runtime/spriteApi.ts           # the facade users call as `sprite` (Task 7)
src/runtime/executor.ts            # compiles user scripts, injects globals (Task 8)
```

Tests are colocated: `src/runtime/<name>.test.ts`.

---

### Task 1: Project scaffold with Vitest

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/main.tsx`, `src/App.tsx`, `src/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` runs Vitest; `npm run dev` serves a placeholder page. All later tasks rely on this toolchain.

- [ ] **Step 1: Write the files**

`package.json`:
```json
{
  "name": "game-grand",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node' },
})
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Game Grand</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`src/App.tsx`:
```tsx
export default function App() {
  return <h1>Game Grand</h1>
}
```

`.gitignore`:
```
node_modules
dist
```

`src/scaffold.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('scaffold', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 2: Install and run the test**

Run: `npm install && npm test`
Expected: PASS (1 test). Also run `npm run build` — expected to succeed.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TS + Vitest"
```

---

### Task 2: Friendly errors and validators

**Files:**
- Create: `src/runtime/errors.ts`
- Test: `src/runtime/errors.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `class FriendlyError extends Error`; `expectNumber(fn: string, example: string, value: unknown): number`; `expectString(fn: string, example: string, value: unknown): string`; `expectFunction(fn: string, example: string, value: unknown): Function`. Every API method in later tasks validates through these.

- [ ] **Step 1: Write the failing test**

`src/runtime/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { FriendlyError, expectNumber, expectString, expectFunction } from './errors'

describe('validators', () => {
  it('passes valid values through', () => {
    expect(expectNumber('move', 'sprite.move(10)', 5)).toBe(5)
    expect(expectString('broadcast', 'broadcast("go")', 'go')).toBe('go')
    const fn = () => {}
    expect(expectFunction('onStart', 'onStart(() => { ... })', fn)).toBe(fn)
  })

  it('throws a FriendlyError with example and received value', () => {
    try {
      expectNumber('move', 'sprite.move(10)', 'fast')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(FriendlyError)
      const msg = (e as Error).message
      expect(msg).toContain('`move` needs a number')
      expect(msg).toContain('sprite.move(10)')
      expect(msg).toContain('"fast"')
    }
  })

  it('rejects NaN and undefined as numbers', () => {
    expect(() => expectNumber('wait', 'wait(1)', NaN)).toThrow(FriendlyError)
    expect(() => expectNumber('wait', 'wait(1)', undefined)).toThrow(/nothing/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runtime/errors.test.ts`
Expected: FAIL — cannot resolve `./errors`.

- [ ] **Step 3: Write the implementation**

`src/runtime/errors.ts`:
```ts
export class FriendlyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FriendlyError'
  }
}

function show(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === undefined) return 'nothing'
  if (typeof value === 'function') return 'a function'
  return String(value)
}

export function expectNumber(fn: string, example: string, value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new FriendlyError(
      `\`${fn}\` needs a number, like \`${example}\` — you gave it ${show(value)}.`,
    )
  }
  return value
}

export function expectString(fn: string, example: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new FriendlyError(
      `\`${fn}\` needs some text in quotes, like \`${example}\` — you gave it ${show(value)}.`,
    )
  }
  return value
}

export function expectFunction(fn: string, example: string, value: unknown): Function {
  if (typeof value !== 'function') {
    throw new FriendlyError(
      `\`${fn}\` needs a function, like \`${example}\` — you gave it ${show(value)}.`,
    )
  }
  return value
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/runtime/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/errors.ts src/runtime/errors.test.ts
git commit -m "feat: kid-friendly argument validators"
```

---

### Task 3: Clock — tickable time, waits, frame callbacks

**Files:**
- Create: `src/runtime/clock.ts`
- Test: `src/runtime/clock.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `class Clock` with `now: number` (seconds, getter), `tick(dt: number): void`, `wait(secs: number): Promise<void>`, `onFrame(cb: (dt: number) => void): () => void` (returns unsubscribe), `clearAll(): void`. The renderer (Plan 2) calls `tick`; `glide`/`wait`/timed `say` build on this.

- [ ] **Step 1: Write the failing test**

`src/runtime/clock.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Clock } from './clock'

const flush = () => Promise.resolve()

describe('Clock', () => {
  it('advances now by dt', () => {
    const c = new Clock()
    c.tick(0.5)
    c.tick(0.25)
    expect(c.now).toBeCloseTo(0.75)
  })

  it('resolves wait only after enough time has passed', async () => {
    const c = new Clock()
    let done = false
    c.wait(1).then(() => { done = true })
    c.tick(0.5); await flush()
    expect(done).toBe(false)
    c.tick(0.6); await flush()
    expect(done).toBe(true)
  })

  it('calls frame callbacks with dt and honors unsubscribe', () => {
    const c = new Clock()
    const dts: number[] = []
    const unsub = c.onFrame(dt => dts.push(dt))
    c.tick(0.1)
    unsub()
    c.tick(0.2)
    expect(dts).toEqual([0.1])
  })

  it('clearAll abandons pending waits and frame callbacks', async () => {
    const c = new Clock()
    let done = false
    c.wait(1).then(() => { done = true })
    let frames = 0
    c.onFrame(() => frames++)
    c.clearAll()
    c.tick(2); await flush()
    expect(done).toBe(false)
    expect(frames).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runtime/clock.test.ts`
Expected: FAIL — cannot resolve `./clock`.

- [ ] **Step 3: Write the implementation**

`src/runtime/clock.ts`:
```ts
type FrameCb = (dt: number) => void

export class Clock {
  private time = 0
  private frameCbs = new Set<FrameCb>()
  private waits: { due: number; resolve: () => void }[] = []

  get now(): number {
    return this.time
  }

  tick(dt: number): void {
    this.time += dt
    for (const cb of [...this.frameCbs]) cb(dt)
    const due = this.waits.filter(w => w.due <= this.time)
    this.waits = this.waits.filter(w => w.due > this.time)
    for (const w of due) w.resolve()
  }

  wait(secs: number): Promise<void> {
    return new Promise(resolve => {
      this.waits.push({ due: this.time + secs, resolve })
    })
  }

  onFrame(cb: FrameCb): () => void {
    this.frameCbs.add(cb)
    return () => this.frameCbs.delete(cb)
  }

  clearAll(): void {
    this.frameCbs.clear()
    this.waits = []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/runtime/clock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/clock.ts src/runtime/clock.test.ts
git commit -m "feat: tickable clock with waits and frame callbacks"
```

---

### Task 4: SpriteModel — motion

**Files:**
- Create: `src/runtime/spriteModel.ts`
- Test: `src/runtime/spriteModel.test.ts`

**Interfaces:**
- Consumes: `Clock` (Task 3), validators (Task 2)
- Produces: `interface Costume { name: string; width: number; height: number; source: string }`, `type RotationStyle`, constants `STAGE_WIDTH = 480`, `STAGE_HEIGHT = 360`, and `class SpriteModel` with fields `name, x, y, direction, size, visible, rotationStyle, effects, sayBubble, currentCostume, costumes, deleted, isClone` and motion methods `move(steps)`, `turnRight(deg)`, `turnLeft(deg)`, `goTo(x, y)`, `changeX(n)`, `changeY(n)`, `pointInDirection(deg)`, `pointTowards(target: {x: number; y: number})`, `setRotationStyle(style)`, `glide(x, y, secs): Promise<void>`, `ifOnEdgeBounce()`. Constructor: `new SpriteModel(name: string, costumes: Costume[], clock: Clock)`.

- [ ] **Step 1: Write the failing test**

`src/runtime/spriteModel.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Clock } from './clock'
import { SpriteModel, type Costume } from './spriteModel'
import { FriendlyError } from './errors'

const cat: Costume[] = [{ name: 'cat-a', width: 20, height: 20, source: 'library:cat-a' }]
const make = () => {
  const clock = new Clock()
  return { clock, s: new SpriteModel('Cat', cat, clock) }
}

describe('SpriteModel motion', () => {
  it('moves along its direction (90 = right, 0 = up)', () => {
    const { s } = make()
    s.move(10)
    expect(s.x).toBeCloseTo(10)
    expect(s.y).toBeCloseTo(0)
    s.pointInDirection(0)
    s.move(10)
    expect(s.y).toBeCloseTo(10)
  })

  it('validates arguments with FriendlyError', () => {
    const { s } = make()
    expect(() => s.move('fast' as unknown as number)).toThrow(FriendlyError)
  })

  it('wraps direction to (-180, 180]', () => {
    const { s } = make()
    s.turnRight(270) // 90 + 270 = 360 -> 0
    expect(s.direction).toBe(0)
    s.turnLeft(270) // 0 - 270 = -270 -> 90
    expect(s.direction).toBe(90)
  })

  it('points towards a target', () => {
    const { s } = make()
    s.goTo(0, 0)
    s.pointTowards({ x: 10, y: 0 })
    expect(s.direction).toBeCloseTo(90)
    s.pointTowards({ x: 0, y: 10 })
    expect(s.direction).toBeCloseTo(0)
  })

  it('glides linearly over time', async () => {
    const { clock, s } = make()
    const done = s.glide(100, 0, 2)
    clock.tick(1)
    expect(s.x).toBeCloseTo(50)
    clock.tick(1)
    await done
    expect(s.x).toBeCloseTo(100)
  })

  it('glide with zero seconds jumps immediately', async () => {
    const { s } = make()
    await s.glide(30, 40, 0)
    expect(s.x).toBe(30)
    expect(s.y).toBe(40)
  })

  it('bounces off the right edge: flips direction and clamps inside', () => {
    const { s } = make() // costume 20 wide -> halfW 10
    s.goTo(235, 0)
    s.pointInDirection(90)
    s.ifOnEdgeBounce()
    expect(s.direction).toBe(-90)
    expect(s.x).toBe(230)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runtime/spriteModel.test.ts`
Expected: FAIL — cannot resolve `./spriteModel`.

- [ ] **Step 3: Write the implementation**

`src/runtime/spriteModel.ts`:
```ts
import { Clock } from './clock'
import { FriendlyError, expectNumber } from './errors'

export interface Costume {
  name: string
  width: number
  height: number
  source: string
}

export type RotationStyle = 'all around' | 'left-right' | "don't rotate"

export const STAGE_WIDTH = 480
export const STAGE_HEIGHT = 360

export function wrapDirection(d: number): number {
  const n = ((d % 360) + 360) % 360
  return n > 180 ? n - 360 : n
}

export class SpriteModel {
  x = 0
  y = 0
  direction = 90
  size = 100
  visible = true
  rotationStyle: RotationStyle = 'all around'
  effects: Record<string, number> = {}
  sayBubble: { text: string; kind: 'say' | 'think' } | null = null
  currentCostume = 0
  deleted = false
  isClone = false

  constructor(
    public name: string,
    public costumes: Costume[],
    private clock: Clock,
  ) {}

  halfExtents(): { halfW: number; halfH: number } {
    const c = this.costumes[this.currentCostume]
    return {
      halfW: ((c?.width ?? 0) * this.size) / 200,
      halfH: ((c?.height ?? 0) * this.size) / 200,
    }
  }

  move(steps: unknown): void {
    const n = expectNumber('move', 'sprite.move(10)', steps)
    const rad = (this.direction * Math.PI) / 180
    this.x += n * Math.sin(rad)
    this.y += n * Math.cos(rad)
  }

  turnRight(deg: unknown): void {
    const n = expectNumber('turnRight', 'sprite.turnRight(15)', deg)
    this.direction = wrapDirection(this.direction + n)
  }

  turnLeft(deg: unknown): void {
    const n = expectNumber('turnLeft', 'sprite.turnLeft(15)', deg)
    this.direction = wrapDirection(this.direction - n)
  }

  goTo(x: unknown, y: unknown): void {
    this.x = expectNumber('goTo', 'sprite.goTo(0, 0)', x)
    this.y = expectNumber('goTo', 'sprite.goTo(0, 0)', y)
  }

  changeX(n: unknown): void {
    this.x += expectNumber('changeX', 'sprite.changeX(10)', n)
  }

  changeY(n: unknown): void {
    this.y += expectNumber('changeY', 'sprite.changeY(10)', n)
  }

  pointInDirection(deg: unknown): void {
    const n = expectNumber('pointInDirection', 'sprite.pointInDirection(90)', deg)
    this.direction = wrapDirection(n)
  }

  pointTowards(target: { x: number; y: number }): void {
    const deg = (Math.atan2(target.x - this.x, target.y - this.y) * 180) / Math.PI
    this.direction = wrapDirection(deg)
  }

  setRotationStyle(style: unknown): void {
    const valid: RotationStyle[] = ['all around', 'left-right', "don't rotate"]
    if (!valid.includes(style as RotationStyle)) {
      throw new FriendlyError(
        `\`setRotationStyle\` needs one of ${valid.map(v => `"${v}"`).join(', ')} — you gave it ${JSON.stringify(style)}.`,
      )
    }
    this.rotationStyle = style as RotationStyle
  }

  glide(x: unknown, y: unknown, secs: unknown): Promise<void> {
    const tx = expectNumber('glide', 'sprite.glide(100, 100, 1)', x)
    const ty = expectNumber('glide', 'sprite.glide(100, 100, 1)', y)
    const s = expectNumber('glide', 'sprite.glide(100, 100, 1)', secs)
    if (s <= 0) {
      this.x = tx
      this.y = ty
      return Promise.resolve()
    }
    const sx = this.x
    const sy = this.y
    const start = this.clock.now
    return new Promise(resolve => {
      const unsub = this.clock.onFrame(() => {
        const t = Math.min(1, (this.clock.now - start) / s)
        this.x = sx + (tx - sx) * t
        this.y = sy + (ty - sy) * t
        if (t >= 1) {
          unsub()
          resolve()
        }
      })
    })
  }

  ifOnEdgeBounce(): void {
    const { halfW, halfH } = this.halfExtents()
    const R = STAGE_WIDTH / 2
    const T = STAGE_HEIGHT / 2
    if (this.x + halfW > R || this.x - halfW < -R) {
      this.direction = wrapDirection(-this.direction)
    }
    if (this.y + halfH > T || this.y - halfH < -T) {
      this.direction = wrapDirection(180 - this.direction)
    }
    this.x = Math.min(Math.max(this.x, -R + halfW), R - halfW)
    this.y = Math.min(Math.max(this.y, -T + halfH), T - halfH)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/runtime/spriteModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/spriteModel.ts src/runtime/spriteModel.test.ts
git commit -m "feat: sprite motion model with Scratch coordinates"
```

---

### Task 5: SpriteModel looks + StageModel backdrops

**Files:**
- Modify: `src/runtime/spriteModel.ts` (add looks methods to `SpriteModel`)
- Create: `src/runtime/stageModel.ts`
- Test: `src/runtime/looks.test.ts`

**Interfaces:**
- Consumes: `Clock`, validators
- Produces: on `SpriteModel`: `say(text, secs?): Promise<void> | void`, `think(text, secs?)`, `switchCostume(name)`, `nextCostume()`, `setSize(percent)` (clamped 5–500), `show()`, `hide()`, `setEffect(name, value)` (names: `'ghost' | 'brightness' | 'color'`), `clearEffects()`. `class StageModel` with `backdrops: Costume[]`, `currentBackdrop: number`, `onBackdropChange: ((name: string) => void) | null`, `switchBackdrop(name)`, `nextBackdrop()`. Constructor: `new StageModel(backdrops: Costume[])`.

- [ ] **Step 1: Write the failing test**

`src/runtime/looks.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Clock } from './clock'
import { SpriteModel, type Costume } from './spriteModel'
import { StageModel } from './stageModel'
import { FriendlyError } from './errors'

const costumes: Costume[] = [
  { name: 'cat-a', width: 20, height: 20, source: 'library:cat-a' },
  { name: 'cat-b', width: 20, height: 20, source: 'library:cat-b' },
]
const flush = () => Promise.resolve()

describe('SpriteModel looks', () => {
  it('say sets a bubble; timed say clears it after the time', async () => {
    const clock = new Clock()
    const s = new SpriteModel('Cat', costumes, clock)
    const done = s.say('Hello!', 2)
    expect(s.sayBubble).toEqual({ text: 'Hello!', kind: 'say' })
    clock.tick(2.1)
    await done
    expect(s.sayBubble).toBeNull()
  })

  it('a newer bubble is not cleared by an older timer', async () => {
    const clock = new Clock()
    const s = new SpriteModel('Cat', costumes, clock)
    const first = s.say('one', 1)
    s.say('two')
    clock.tick(1.1)
    await first
    expect(s.sayBubble).toEqual({ text: 'two', kind: 'say' })
  })

  it('an older timer does not clear a newer bubble with the same text', async () => {
    const clock = new Clock()
    const s = new SpriteModel('Cat', costumes, clock)
    const first = s.say('Hi', 1)
    const second = s.say('Hi', 5)
    clock.tick(1.1)
    await first
    expect(s.sayBubble).toEqual({ text: 'Hi', kind: 'say' })
    clock.tick(4.5)
    await second
    expect(s.sayBubble).toBeNull()
  })

  it('switches costumes by name and errors helpfully on unknown names', () => {
    const clock = new Clock()
    const s = new SpriteModel('Cat', costumes, clock)
    s.switchCostume('cat-b')
    expect(s.currentCostume).toBe(1)
    s.nextCostume()
    expect(s.currentCostume).toBe(0)
    expect(() => s.switchCostume('dog')).toThrow(/cat-a/)
  })

  it('clamps size and validates effects', () => {
    const clock = new Clock()
    const s = new SpriteModel('Cat', costumes, clock)
    s.setSize(9999)
    expect(s.size).toBe(500)
    s.setSize(1)
    expect(s.size).toBe(5)
    s.setEffect('ghost', 50)
    expect(s.effects.ghost).toBe(50)
    expect(() => s.setEffect('sparkle', 1)).toThrow(FriendlyError)
    s.clearEffects()
    expect(s.effects).toEqual({})
  })
})

describe('StageModel', () => {
  it('switches backdrops and notifies', () => {
    const stage = new StageModel(costumes)
    const seen: string[] = []
    stage.onBackdropChange = name => seen.push(name)
    stage.switchBackdrop('cat-b')
    expect(stage.currentBackdrop).toBe(1)
    stage.nextBackdrop() // wraps to 0
    expect(stage.currentBackdrop).toBe(0)
    expect(seen).toEqual(['cat-b', 'cat-a'])
    expect(() => stage.switchBackdrop('nope')).toThrow(FriendlyError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runtime/looks.test.ts`
Expected: FAIL — `say` not a function / cannot resolve `./stageModel`.

- [ ] **Step 3: Write the implementation**

Add to `SpriteModel` in `src/runtime/spriteModel.ts` (import `expectString` too):
```ts
  private bubbleGen = 0

  private bubble(kind: 'say' | 'think', text: unknown, secs?: unknown): Promise<void> | void {
    const gen = ++this.bubbleGen
    const t = String(text ?? '')
    this.sayBubble = t === '' ? null : { text: t, kind }
    if (secs === undefined) return
    const s = expectNumber(kind, `sprite.${kind}("Hi", 2)`, secs)
    return this.clock.wait(s).then(() => {
      if (this.bubbleGen === gen) this.sayBubble = null
    })
  }

  say(text: unknown, secs?: unknown): Promise<void> | void {
    return this.bubble('say', text, secs)
  }

  think(text: unknown, secs?: unknown): Promise<void> | void {
    return this.bubble('think', text, secs)
  }

  switchCostume(name: unknown): void {
    const n = expectString('switchCostume', 'sprite.switchCostume("cat-a")', name)
    const idx = this.costumes.findIndex(c => c.name === n)
    if (idx === -1) {
      const names = this.costumes.map(c => `"${c.name}"`).join(', ')
      throw new FriendlyError(
        `\`switchCostume\` couldn't find a costume called "${n}". This sprite's costumes are: ${names}.`,
      )
    }
    this.currentCostume = idx
  }

  nextCostume(): void {
    this.currentCostume = (this.currentCostume + 1) % this.costumes.length
  }

  setSize(percent: unknown): void {
    const n = expectNumber('setSize', 'sprite.setSize(150)', percent)
    this.size = Math.min(500, Math.max(5, n))
  }

  show(): void {
    this.visible = true
  }

  hide(): void {
    this.visible = false
  }

  setEffect(name: unknown, value: unknown): void {
    const known = ['ghost', 'brightness', 'color']
    if (typeof name !== 'string' || !known.includes(name)) {
      throw new FriendlyError(
        `\`setEffect\` knows these effects: ${known.map(k => `"${k}"`).join(', ')} — you gave it ${JSON.stringify(name)}.`,
      )
    }
    this.effects[name] = expectNumber('setEffect', 'sprite.setEffect("ghost", 50)', value)
  }

  clearEffects(): void {
    this.effects = {}
  }
```

`src/runtime/stageModel.ts`:
```ts
import { FriendlyError, expectString } from './errors'
import type { Costume } from './spriteModel'

export class StageModel {
  currentBackdrop = 0
  onBackdropChange: ((name: string) => void) | null = null

  constructor(public backdrops: Costume[]) {}

  switchBackdrop(name: unknown): void {
    const n = expectString('switchBackdrop', 'stage.switchBackdrop("blue-sky")', name)
    const idx = this.backdrops.findIndex(b => b.name === n)
    if (idx === -1) {
      const names = this.backdrops.map(b => `"${b.name}"`).join(', ')
      throw new FriendlyError(
        `\`switchBackdrop\` couldn't find a backdrop called "${n}". The backdrops are: ${names}.`,
      )
    }
    this.currentBackdrop = idx
    this.onBackdropChange?.(n)
  }

  nextBackdrop(): void {
    this.currentBackdrop = (this.currentBackdrop + 1) % this.backdrops.length
    this.onBackdropChange?.(this.backdrops[this.currentBackdrop].name)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/runtime/looks.test.ts src/runtime/spriteModel.test.ts`
Expected: PASS (both files — motion tests must still pass).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/spriteModel.ts src/runtime/stageModel.ts src/runtime/looks.test.ts
git commit -m "feat: sprite looks (bubbles, costumes, effects) and stage backdrops"
```

---

### Task 6: EventBus + sensing helpers

**Files:**
- Create: `src/runtime/eventBus.ts`, `src/runtime/sensing.ts`
- Test: `src/runtime/eventBus.test.ts`, `src/runtime/sensing.test.ts`

**Interfaces:**
- Consumes: `SpriteModel`
- Produces: `class EventBus` with `onError: (err: unknown) => void`, `register(event: string, handler: (...args: unknown[]) => unknown): void`, `fire(event: string, ...args: unknown[]): void`, `clear(): void`. Event-name conventions used by Tasks 7–8: `'start'`, `` `key:${key}` ``, `` `click:${spriteName}` ``, `` `message:${name}` ``, `` `backdrop:${name}` ``, `'update'`, `` `clone:${spriteName}` ``. From `sensing.ts`: `bounds(s: SpriteModel): { left; right; top; bottom }`, `touchingSprites(a: SpriteModel, b: SpriteModel): boolean`, `touchingEdge(a: SpriteModel): boolean`, `distanceBetween(a: SpriteModel, p: { x: number; y: number }): number`.

- [ ] **Step 1: Write the failing tests**

`src/runtime/eventBus.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { EventBus } from './eventBus'

const flush = () => Promise.resolve()

describe('EventBus', () => {
  it('fires all handlers for an event with args', () => {
    const bus = new EventBus()
    const seen: unknown[] = []
    bus.register('key:right', a => seen.push(a))
    bus.register('key:right', a => seen.push(a))
    bus.fire('key:right', 42)
    expect(seen).toEqual([42, 42])
  })

  it('routes sync and async handler errors to onError without stopping others', async () => {
    const bus = new EventBus()
    const errors: unknown[] = []
    bus.onError = e => errors.push(e)
    let ran = false
    bus.register('start', () => { throw new Error('sync boom') })
    bus.register('start', async () => { throw new Error('async boom') })
    bus.register('start', () => { ran = true })
    bus.fire('start')
    await flush()
    expect(ran).toBe(true)
    expect(errors).toHaveLength(2)
  })

  it('clear removes all handlers', () => {
    const bus = new EventBus()
    let n = 0
    bus.register('update', () => n++)
    bus.clear()
    bus.fire('update')
    expect(n).toBe(0)
  })
})
```

`src/runtime/sensing.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Clock } from './clock'
import { SpriteModel, type Costume } from './spriteModel'
import { touchingSprites, touchingEdge, distanceBetween } from './sensing'

const c20: Costume[] = [{ name: 'a', width: 20, height: 20, source: 'library:a' }]
const at = (x: number, y: number) => {
  const s = new SpriteModel('S', c20, new Clock())
  s.goTo(x, y)
  return s
}

describe('sensing', () => {
  it('detects AABB overlap scaled by size', () => {
    const a = at(0, 0)
    const b = at(15, 0) // half-widths 10+10, distance 15 -> overlap
    expect(touchingSprites(a, b)).toBe(true)
    b.goTo(25, 0)
    expect(touchingSprites(a, b)).toBe(false)
    b.setSize(200) // halfW now 20; 10 + 20 > 25
    expect(touchingSprites(a, b)).toBe(true)
  })

  it('hidden or deleted sprites never touch', () => {
    const a = at(0, 0)
    const b = at(0, 0)
    b.hide()
    expect(touchingSprites(a, b)).toBe(false)
    b.show()
    b.deleted = true
    expect(touchingSprites(a, b)).toBe(false)
  })

  it('detects the stage edge', () => {
    expect(touchingEdge(at(0, 0))).toBe(false)
    expect(touchingEdge(at(235, 0))).toBe(true)
    expect(touchingEdge(at(0, -175))).toBe(true)
  })

  it('measures distance between centers', () => {
    expect(distanceBetween(at(0, 0), { x: 3, y: 4 })).toBeCloseTo(5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/runtime/eventBus.test.ts src/runtime/sensing.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`src/runtime/eventBus.ts`:
```ts
export type Handler = (...args: unknown[]) => unknown

export class EventBus {
  private handlers = new Map<string, Handler[]>()
  onError: (err: unknown) => void = () => {}

  register(event: string, handler: Handler): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  fire(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) {
      try {
        const r = h(...args)
        if (r instanceof Promise) r.catch(err => this.onError(err))
      } catch (err) {
        this.onError(err)
      }
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}
```

`src/runtime/sensing.ts`:
```ts
import { SpriteModel, STAGE_WIDTH, STAGE_HEIGHT } from './spriteModel'

export function bounds(s: SpriteModel): { left: number; right: number; top: number; bottom: number } {
  const { halfW, halfH } = s.halfExtents()
  return { left: s.x - halfW, right: s.x + halfW, top: s.y + halfH, bottom: s.y - halfH }
}

export function touchingSprites(a: SpriteModel, b: SpriteModel): boolean {
  if (!a.visible || !b.visible || a.deleted || b.deleted) return false
  const A = bounds(a)
  const B = bounds(b)
  return A.left < B.right && B.left < A.right && A.bottom < B.top && B.bottom < A.top
}

export function touchingEdge(a: SpriteModel): boolean {
  const A = bounds(a)
  return (
    A.left <= -STAGE_WIDTH / 2 ||
    A.right >= STAGE_WIDTH / 2 ||
    A.bottom <= -STAGE_HEIGHT / 2 ||
    A.top >= STAGE_HEIGHT / 2
  )
}

export function distanceBetween(a: SpriteModel, p: { x: number; y: number }): number {
  return Math.hypot(p.x - a.x, p.y - a.y)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/runtime/eventBus.test.ts src/runtime/sensing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/eventBus.ts src/runtime/sensing.ts src/runtime/eventBus.test.ts src/runtime/sensing.test.ts
git commit -m "feat: event bus with safe dispatch and AABB sensing"
```

---

### Task 7: World + sprite facade

**Files:**
- Create: `src/runtime/world.ts`, `src/runtime/spriteApi.ts`
- Test: `src/runtime/world.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6
- Produces:
  - `class World`, constructor `new World(opts: { backdrops: Costume[]; soundNames: string[] })`. Public: `clock: Clock`, `bus: EventBus`, `stage: StageModel`, `sprites: SpriteModel[]` (array order = layer order, last drawn on top), `keys: Set<string>`, `mouse: { x: number; y: number; isDown: boolean }`, `volume: number`, `watches: { name: string; get: () => unknown }[]`, `running: boolean`. Methods: `addSprite(name, costumes): SpriteModel`, `get timer(): number`, `resetTimer()`, `broadcast(name)`, `goToFront(s)`, `goBack(s, n)`, `clone(src): SpriteModel` (fires `` `clone:${src.name}` `` with the new model), `removeClone(s)`, `stopAll()`, `tick(dt)` (fires `'update'` with dt, then ticks the clock; no-op when stopped), `keyDown(key)` / `keyUp(key)`, `mouseMove(x, y)`, `clickAt(x, y)` (fires `` `click:${name}` `` for the topmost visible sprite containing the point), `playSound(name)`, `playSoundUntilDone(name): Promise<void>`, `soundFinished(id)`, `snapshot()`.
  - `snapshot()` returns `{ sprites: [{ name, x, y, direction, size, visible, rotationStyle, costume, effects, bubble, isClone }], backdrop: string | null, watches: [{ name, value: string }], sounds: [{ id, name }] }` — the sounds array is drained on each call (renderer plays each once).
  - `makeSpriteApi(model: SpriteModel, world: World)` from `spriteApi.ts`: the object users see as `sprite` — all motion/looks methods delegated, plus `name`/`x`/`y`/`direction` getters, `goToFront()`, `goBack(n)`, `touching(target: string)` (`'edge'` or a sprite name; touching any sprite/clone with that name counts), `distanceTo(target: string | { x; y })` (`'mouse'` supported), `pointTowards(target: string | { x; y })` (`'mouse'` or sprite name or point), `clone()`, `deleteClone()`.

- [ ] **Step 1: Write the failing test**

`src/runtime/world.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { World } from './world'
import { makeSpriteApi } from './spriteApi'
import type { Costume } from './spriteModel'
import { FriendlyError } from './errors'

const c20: Costume[] = [{ name: 'a', width: 20, height: 20, source: 'library:a' }]
const backdrop: Costume[] = [{ name: 'sky', width: 480, height: 360, source: 'library:sky' }]
const makeWorld = () => new World({ backdrops: backdrop, soundNames: ['meow'] })

describe('World', () => {
  it('broadcast fires message handlers', () => {
    const w = makeWorld()
    let heard = false
    w.bus.register('message:go', () => { heard = true })
    w.broadcast('go')
    expect(heard).toBe(true)
    expect(() => w.broadcast(42)).toThrow(FriendlyError)
  })

  it('clone copies state, is appended on top, and fires clone event', () => {
    const w = makeWorld()
    const cat = w.addSprite('Cat', c20)
    cat.goTo(50, 60)
    let cloned: unknown = null
    w.bus.register('clone:Cat', m => { cloned = m })
    const c = w.clone(cat)
    expect(c.isClone).toBe(true)
    expect(c.x).toBe(50)
    expect(cloned).toBe(c)
    expect(w.sprites[w.sprites.length - 1]).toBe(c)
    w.removeClone(c)
    expect(w.sprites).not.toContain(c)
    w.removeClone(cat) // originals are never removed
    expect(w.sprites).toContain(cat)
  })

  it('layer order: goToFront and goBack reorder the array', () => {
    const w = makeWorld()
    const a = w.addSprite('A', c20)
    const b = w.addSprite('B', c20)
    w.goToFront(a)
    expect(w.sprites).toEqual([b, a])
    w.goBack(a, 1)
    expect(w.sprites).toEqual([a, b])
  })

  it('clickAt hits the topmost visible sprite at the point', () => {
    const w = makeWorld()
    const a = w.addSprite('A', c20)
    const b = w.addSprite('B', c20) // same spot, on top
    const clicks: string[] = []
    w.bus.register('click:A', () => clicks.push('A'))
    w.bus.register('click:B', () => clicks.push('B'))
    w.clickAt(0, 0)
    b.hide()
    w.clickAt(0, 0)
    w.clickAt(200, 200) // empty space
    expect(clicks).toEqual(['B', 'A'])
  })

  it('tick fires update then advances the clock; stopAll halts everything', () => {
    const w = makeWorld()
    let updates = 0
    w.bus.register('update', () => updates++)
    w.tick(0.1)
    expect(updates).toBe(1)
    expect(w.clock.now).toBeCloseTo(0.1)
    w.stopAll()
    w.tick(0.1)
    expect(updates).toBe(1)
    expect(w.running).toBe(false)
  })

  it('timer tracks clock time and resets', () => {
    const w = makeWorld()
    w.tick(1.5)
    expect(w.timer).toBeCloseTo(1.5)
    w.resetTimer()
    expect(w.timer).toBe(0)
  })

  it('sounds queue into the snapshot and drain; playSoundUntilDone resolves on soundFinished', async () => {
    const w = makeWorld()
    w.playSound('meow')
    const done = w.playSoundUntilDone('meow')
    const snap = w.snapshot()
    expect(snap.sounds.map(s => s.name)).toEqual(['meow', 'meow'])
    expect(w.snapshot().sounds).toEqual([]) // drained
    let resolved = false
    done.then(() => { resolved = true })
    w.soundFinished(snap.sounds[1].id)
    await Promise.resolve()
    expect(resolved).toBe(true)
    expect(() => w.playSound('bark')).toThrow(/meow/)
  })
})

describe('sprite facade', () => {
  it('exposes delegated motion and world-aware sensing', () => {
    const w = makeWorld()
    const cat = w.addSprite('Cat', c20)
    const bat = w.addSprite('Bat', c20)
    const api = makeSpriteApi(cat, w)
    api.move(10)
    expect(api.x).toBeCloseTo(10)
    bat.goTo(15, 0)
    expect(api.touching('Bat')).toBe(true)
    expect(api.touching('edge')).toBe(false)
    expect(() => api.touching('Dog')).toThrow(/Bat/)
    expect(() => api.touching('mouse')).toThrow(/edge/) // 'mouse' is not a touching target
    w.mouse.x = 13
    w.mouse.y = 4
    expect(api.distanceTo('mouse')).toBeCloseTo(5)
    api.deleteClone() // original: no-op
    expect(w.sprites).toContain(cat)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runtime/world.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`src/runtime/world.ts`:
```ts
import { Clock } from './clock'
import { EventBus } from './eventBus'
import { StageModel } from './stageModel'
import { SpriteModel, type Costume } from './spriteModel'
import { bounds } from './sensing'
import { FriendlyError, expectString } from './errors'

export interface WatchEntry {
  name: string
  get: () => unknown
}

export interface WorldOptions {
  backdrops: Costume[]
  soundNames: string[]
}

export class World {
  clock = new Clock()
  bus = new EventBus()
  stage: StageModel
  sprites: SpriteModel[] = []
  keys = new Set<string>()
  mouse = { x: 0, y: 0, isDown: false }
  volume = 100
  watches: WatchEntry[] = []
  running = true

  private soundNames: string[]
  private soundId = 0
  private soundQueue: { id: number; name: string }[] = []
  private pendingSounds = new Map<number, () => void>()
  private timerStart = 0

  constructor(opts: WorldOptions) {
    this.stage = new StageModel(opts.backdrops)
    this.soundNames = opts.soundNames
    this.stage.onBackdropChange = name => this.bus.fire(`backdrop:${name}`)
  }

  addSprite(name: string, costumes: Costume[]): SpriteModel {
    const s = new SpriteModel(name, costumes, this.clock)
    this.sprites.push(s)
    return s
  }

  get timer(): number {
    return this.clock.now - this.timerStart
  }

  resetTimer(): void {
    this.timerStart = this.clock.now
  }

  broadcast(name: unknown): void {
    const n = expectString('broadcast', 'broadcast("go")', name)
    this.bus.fire(`message:${n}`)
  }

  goToFront(s: SpriteModel): void {
    this.sprites = this.sprites.filter(x => x !== s)
    this.sprites.push(s)
  }

  goBack(s: SpriteModel, n: number): void {
    const from = this.sprites.indexOf(s)
    if (from === -1) return
    this.sprites.splice(from, 1)
    this.sprites.splice(Math.max(0, from - n), 0, s)
  }

  clone(src: SpriteModel): SpriteModel {
    const c = new SpriteModel(src.name, src.costumes, this.clock)
    c.x = src.x
    c.y = src.y
    c.direction = src.direction
    c.size = src.size
    c.visible = src.visible
    c.rotationStyle = src.rotationStyle
    c.currentCostume = src.currentCostume
    c.effects = { ...src.effects }
    c.isClone = true
    this.sprites.push(c)
    this.bus.fire(`clone:${src.name}`, c)
    return c
  }

  removeClone(s: SpriteModel): void {
    if (!s.isClone) return
    s.deleted = true
    this.sprites = this.sprites.filter(x => x !== s)
  }

  stopAll(): void {
    this.running = false
    this.clock.clearAll()
    this.bus.clear()
  }

  tick(dt: number): void {
    if (!this.running) return
    this.bus.fire('update', dt)
    this.clock.tick(dt)
  }

  keyDown(key: string): void {
    this.keys.add(key)
    this.bus.fire(`key:${key}`)
  }

  keyUp(key: string): void {
    this.keys.delete(key)
  }

  mouseMove(x: number, y: number): void {
    this.mouse.x = x
    this.mouse.y = y
  }

  clickAt(x: number, y: number): void {
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i]
      if (!s.visible || s.deleted) continue
      const b = bounds(s)
      if (x >= b.left && x <= b.right && y >= b.bottom && y <= b.top) {
        this.bus.fire(`click:${s.name}`)
        return
      }
    }
  }

  private validateSound(fn: string, name: unknown): string {
    const n = expectString(fn, `${fn}("meow")`, name)
    if (!this.soundNames.includes(n)) {
      const names = this.soundNames.map(s => `"${s}"`).join(', ')
      throw new FriendlyError(
        `\`${fn}\` couldn't find a sound called "${n}". This project's sounds are: ${names}.`,
      )
    }
    return n
  }

  playSound(name: unknown): void {
    const n = this.validateSound('playSound', name)
    this.soundQueue.push({ id: ++this.soundId, name: n })
  }

  playSoundUntilDone(name: unknown): Promise<void> {
    const n = this.validateSound('playSoundUntilDone', name)
    const id = ++this.soundId
    this.soundQueue.push({ id, name: n })
    return new Promise(resolve => this.pendingSounds.set(id, resolve))
  }

  soundFinished(id: number): void {
    this.pendingSounds.get(id)?.()
    this.pendingSounds.delete(id)
  }

  snapshot() {
    const sounds = this.soundQueue
    this.soundQueue = []
    return {
      sprites: this.sprites.map(s => ({
        name: s.name,
        x: s.x,
        y: s.y,
        direction: s.direction,
        size: s.size,
        visible: s.visible,
        rotationStyle: s.rotationStyle,
        costume: s.costumes[s.currentCostume]?.name ?? null,
        effects: { ...s.effects },
        bubble: s.sayBubble,
        isClone: s.isClone,
      })),
      backdrop: this.stage.backdrops[this.stage.currentBackdrop]?.name ?? null,
      watches: this.watches.map(w => ({ name: w.name, value: String(w.get()) })),
      sounds,
    }
  }
}
```

`src/runtime/spriteApi.ts`:
```ts
import { SpriteModel } from './spriteModel'
import { World } from './world'
import { touchingSprites, touchingEdge, distanceBetween } from './sensing'
import { FriendlyError } from './errors'

function resolveTarget(
  fn: string,
  world: World,
  self: SpriteModel,
  target: unknown,
): { x: number; y: number } {
  if (target === 'mouse') return world.mouse
  if (typeof target === 'object' && target !== null && 'x' in target && 'y' in target) {
    return target as { x: number; y: number }
  }
  if (typeof target === 'string') {
    const found = world.sprites.find(s => s.name === target && s !== self && !s.deleted)
    if (found) return found
  }
  const names = [...new Set(world.sprites.filter(s => s !== self).map(s => `"${s.name}"`))]
  throw new FriendlyError(
    `\`${fn}\` couldn't find "${String(target)}". Try "mouse" or a sprite name: ${names.join(', ')}.`,
  )
}

export function makeSpriteApi(model: SpriteModel, world: World) {
  return {
    get name() { return model.name },
    get x() { return model.x },
    get y() { return model.y },
    get direction() { return model.direction },
    get size() { return model.size },

    // motion
    move: (steps: unknown) => model.move(steps),
    turnRight: (deg: unknown) => model.turnRight(deg),
    turnLeft: (deg: unknown) => model.turnLeft(deg),
    goTo: (x: unknown, y: unknown) => model.goTo(x, y),
    changeX: (n: unknown) => model.changeX(n),
    changeY: (n: unknown) => model.changeY(n),
    glide: (x: unknown, y: unknown, secs: unknown) => model.glide(x, y, secs),
    pointInDirection: (deg: unknown) => model.pointInDirection(deg),
    pointTowards: (target: unknown) =>
      model.pointTowards(resolveTarget('pointTowards', world, model, target)),
    setRotationStyle: (style: unknown) => model.setRotationStyle(style),
    ifOnEdgeBounce: () => model.ifOnEdgeBounce(),

    // looks
    say: (text: unknown, secs?: unknown) => model.say(text, secs),
    think: (text: unknown, secs?: unknown) => model.think(text, secs),
    switchCostume: (name: unknown) => model.switchCostume(name),
    nextCostume: () => model.nextCostume(),
    setSize: (percent: unknown) => model.setSize(percent),
    show: () => model.show(),
    hide: () => model.hide(),
    setEffect: (name: unknown, value: unknown) => model.setEffect(name, value),
    clearEffects: () => model.clearEffects(),
    goToFront: () => world.goToFront(model),
    goBack: (n: unknown) => world.goBack(model, typeof n === 'number' ? n : 1),

    // sensing
    touching: (target: unknown): boolean => {
      if (target === 'edge') return touchingEdge(model)
      if (typeof target === 'string') {
        const others = world.sprites.filter(
          s => s.name === target && s !== model && !s.deleted,
        )
        if (others.length === 0) {
          // Do NOT reuse resolveTarget here: it special-cases 'mouse' and would
          // return instead of throwing, making touching('mouse') silently false.
          const names = [...new Set(world.sprites.filter(s => s !== model).map(s => `"${s.name}"`))]
          throw new FriendlyError(
            `\`touching\` couldn't find "${target}". Try "edge" or a sprite name: ${names.join(', ')}.`,
          )
        }
        return others.some(o => touchingSprites(model, o))
      }
      throw new FriendlyError(
        `\`touching\` needs "edge" or a sprite name in quotes, like \`sprite.touching("Bat")\`.`,
      )
    },
    distanceTo: (target: unknown): number =>
      distanceBetween(model, resolveTarget('distanceTo', world, model, target)),

    // control
    clone: () => world.clone(model),
    deleteClone: () => world.removeClone(model),
  }
}

export type SpriteApi = ReturnType<typeof makeSpriteApi>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/runtime/world.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/world.ts src/runtime/spriteApi.ts src/runtime/world.test.ts
git commit -m "feat: world (input, clones, layers, sounds, snapshot) and sprite facade"
```

---

### Task 8: Executor — compile and run user scripts

**Files:**
- Create: `src/runtime/executor.ts`
- Test: `src/runtime/executor.test.ts`

**Interfaces:**
- Consumes: `World`, `makeSpriteApi`, `FriendlyError`, validators
- Produces:
  - `interface RunProject { mainScript: string; spriteScripts: { name: string; script: string }[] }`
  - `interface ScriptIssue { tab: string; line: number | null; message: string }`
  - `class Executor`, constructor `new Executor(world: World, opts: { onIssue: (i: ScriptIssue) => void; onLog: (msg: string) => void })`. Methods: `run(project: RunProject): void` (compiles `main` then each sprite script, then fires `'start'`), `globalNames(): string[]` (every global injected into scripts — used by Task 9's coverage test and Plan 2's autocomplete).
  - Globals in **every** script: `vars`, `wait`, `broadcast`, `onStart`, `onKeyPress`, `onMessage`, `onUpdate`, `onBackdropSwitch`, `keyIsDown`, `mouse`, `timer` (live getter), `resetTimer`, `stage` (`{ switchBackdrop, nextBackdrop }`), `playSound`, `playSoundUntilDone`, `setVolume`, `watch`, `stopAll`, `console` (`{ log }`). Sprite scripts additionally: `sprite`, `onClick`, `onCloneStart`. Main additionally: `sprites` (name → facade map).
  - `onCloneStart(fn)` — `fn` receives the clone's facade: `onCloneStart(clone => { clone.goTo(0, 0) })`.
  - Scripts compile via `new Function('__g', 'with (__g) {\n' + source + '\n}')` (non-strict, so `with` is legal; the globals object carries the live `timer` getter). Line numbers in errors are extracted from the V8 stack (`<anonymous>:N`) minus the 3-line wrapper offset.

- [ ] **Step 1: Write the failing test**

`src/runtime/executor.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { World } from './world'
import { Executor, type ScriptIssue } from './executor'
import type { Costume } from './spriteModel'

const c20: Costume[] = [{ name: 'a', width: 20, height: 20, source: 'library:a' }]
const backdrop: Costume[] = [{ name: 'sky', width: 480, height: 360, source: 'library:sky' }]
const flush = () => Promise.resolve()

function setup() {
  const world = new World({ backdrops: backdrop, soundNames: [] })
  world.addSprite('Cat', c20)
  const issues: ScriptIssue[] = []
  const logs: string[] = []
  const ex = new Executor(world, { onIssue: i => issues.push(i), onLog: m => logs.push(m) })
  return { world, ex, issues, logs }
}

describe('Executor', () => {
  it('runs main and sprite scripts; onStart fires on start', async () => {
    const { world, ex, issues } = setup()
    ex.run({
      mainScript: 'vars.score = 5\nwatch("score")',
      spriteScripts: [{ name: 'Cat', script: 'onStart(() => { sprite.move(10) })' }],
    })
    await flush()
    expect(issues).toEqual([])
    expect(world.sprites[0].x).toBeCloseTo(10)
    expect(world.snapshot().watches).toEqual([{ name: 'score', value: '5' }])
  })

  it('vars are shared between main and sprite scripts', async () => {
    const { world, ex, issues } = setup()
    ex.run({
      mainScript: 'vars.score = 1\nwatch("score")',
      spriteScripts: [{ name: 'Cat', script: 'onStart(() => { vars.score = vars.score + 1 })' }],
    })
    await flush()
    expect(issues).toEqual([])
    expect(world.snapshot().watches).toEqual([{ name: 'score', value: '2' }])
  })

  it('reports runtime errors with tab and line, and other handlers keep running', async () => {
    const { world, ex, issues } = setup()
    ex.run({
      mainScript: '',
      spriteScripts: [{
        name: 'Cat',
        script: 'onStart(() => {\n  sprite.move("fast")\n})\nonStart(() => { sprite.changeY(5) })',
      }],
    })
    await flush()
    expect(issues).toHaveLength(1)
    expect(issues[0].tab).toBe('Cat')
    expect(issues[0].line).toBe(2)
    expect(issues[0].message).toContain('`move` needs a number')
    expect(world.sprites[0].y).toBeCloseTo(5)
  })

  it('reports syntax errors with the tab name', () => {
    const { ex, issues } = setup()
    ex.run({ mainScript: 'this is not javascript', spriteScripts: [] })
    expect(issues).toHaveLength(1)
    expect(issues[0].tab).toBe('main')
  })

  it('console.log routes to onLog', () => {
    const { ex, logs } = setup()
    ex.run({ mainScript: 'console.log("hi", 42)', spriteScripts: [] })
    expect(logs).toEqual(['hi 42'])
  })

  it('onKeyPress, timer getter, and wait work end to end', async () => {
    const { world, ex, issues } = setup()
    ex.run({
      mainScript: '',
      spriteScripts: [{
        name: 'Cat',
        script: 'onKeyPress("right", async () => {\n  await wait(1)\n  sprite.changeX(timer)\n})',
      }],
    })
    world.keyDown('right')
    world.tick(1.5)
    await flush()
    await flush()
    expect(issues).toEqual([])
    expect(world.sprites[0].x).toBeCloseTo(1.5)
  })

  it('onCloneStart receives the clone facade', async () => {
    const { world, ex, issues } = setup()
    ex.run({
      mainScript: '',
      spriteScripts: [{
        name: 'Cat',
        script: 'onStart(() => { sprite.clone() })\nonCloneStart(c => { c.goTo(99, 0) })',
      }],
    })
    await flush()
    expect(issues).toEqual([])
    expect(world.sprites).toHaveLength(2)
    expect(world.sprites[1].x).toBe(99)
  })
})
```

Note: the second test's `lastVars` expectation is intentionally trivial (`null`) — sharing itself is proven by the first and seventh tests; do not add a `lastVars` field.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runtime/executor.test.ts`
Expected: FAIL — cannot resolve `./executor`.

- [ ] **Step 3: Write the implementation**

`src/runtime/executor.ts`:
```ts
import { World } from './world'
import { makeSpriteApi, type SpriteApi } from './spriteApi'
import type { SpriteModel } from './spriteModel'
import { FriendlyError, expectFunction, expectNumber, expectString } from './errors'

export interface RunProject {
  mainScript: string
  spriteScripts: { name: string; script: string }[]
}

export interface ScriptIssue {
  tab: string
  line: number | null
  message: string
}

// new Function('__g', 'with (__g) {\n' + src + '\n}') produces:
//   line 1: function anonymous(__g
//   line 2: ) {
//   line 3: with (__g) {
//   line 4: <user line 1>
const LINE_OFFSET = 3

function lineFromStack(err: unknown): number | null {
  const stack = err instanceof Error ? err.stack ?? '' : ''
  const m = stack.match(/<anonymous>:(\d+):/)
  if (!m) return null
  const line = parseInt(m[1], 10) - LINE_OFFSET
  return line >= 1 ? line : null
}

export class Executor {
  private sharedGlobalNames: string[] = []

  constructor(
    private world: World,
    private opts: { onIssue: (i: ScriptIssue) => void; onLog: (msg: string) => void },
  ) {}

  private report(tab: string, err: unknown): void {
    const message =
      err instanceof FriendlyError ? err.message : err instanceof Error ? err.message : String(err)
    this.opts.onIssue({ tab, line: lineFromStack(err), message })
  }

  private wrap(tab: string, fn: Function): (...args: unknown[]) => unknown {
    return (...args: unknown[]) => {
      try {
        const r = fn(...args)
        if (r instanceof Promise) return r.catch(err => this.report(tab, err))
        return r
      } catch (err) {
        this.report(tab, err)
      }
    }
  }

  private buildShared(tab: string, vars: Record<string, unknown>): Record<string, unknown> {
    const w = this.world
    const on = (event: string) => (fn: unknown) => {
      w.bus.register(event, this.wrap(tab, expectFunction('on…', 'onStart(() => { ... })', fn)))
    }
    const g: Record<string, unknown> = {
      vars,
      wait: (secs: unknown) => w.clock.wait(expectNumber('wait', 'wait(1)', secs)),
      broadcast: (name: unknown) => w.broadcast(name),
      onStart: (fn: unknown) =>
        w.bus.register('start', this.wrap(tab, expectFunction('onStart', 'onStart(() => { ... })', fn))),
      onKeyPress: (key: unknown, fn: unknown) =>
        w.bus.register(
          `key:${expectString('onKeyPress', 'onKeyPress("right", () => { ... })', key)}`,
          this.wrap(tab, expectFunction('onKeyPress', 'onKeyPress("right", () => { ... })', fn)),
        ),
      onMessage: (name: unknown, fn: unknown) =>
        w.bus.register(
          `message:${expectString('onMessage', 'onMessage("go", () => { ... })', name)}`,
          this.wrap(tab, expectFunction('onMessage', 'onMessage("go", () => { ... })', fn)),
        ),
      onUpdate: (fn: unknown) =>
        w.bus.register('update', this.wrap(tab, expectFunction('onUpdate', 'onUpdate(() => { ... })', fn))),
      onBackdropSwitch: (name: unknown, fn: unknown) =>
        w.bus.register(
          `backdrop:${expectString('onBackdropSwitch', 'onBackdropSwitch("sky", () => { ... })', name)}`,
          this.wrap(tab, expectFunction('onBackdropSwitch', 'onBackdropSwitch("sky", () => { ... })', fn)),
        ),
      keyIsDown: (key: unknown) =>
        w.keys.has(expectString('keyIsDown', 'keyIsDown("right")', key)),
      mouse: w.mouse,
      resetTimer: () => w.resetTimer(),
      stage: {
        switchBackdrop: (name: unknown) => w.stage.switchBackdrop(name),
        nextBackdrop: () => w.stage.nextBackdrop(),
      },
      playSound: (name: unknown) => w.playSound(name),
      playSoundUntilDone: (name: unknown) => w.playSoundUntilDone(name),
      setVolume: (n: unknown) => {
        w.volume = Math.min(100, Math.max(0, expectNumber('setVolume', 'setVolume(50)', n)))
      },
      watch: (name: unknown) => {
        const n = expectString('watch', 'watch("score")', name)
        w.watches.push({ name: n, get: () => vars[n] })
      },
      stopAll: () => w.stopAll(),
      console: {
        log: (...args: unknown[]) => this.opts.onLog(args.map(a => String(a)).join(' ')),
      },
    }
    Object.defineProperty(g, 'timer', { get: () => w.timer, enumerable: true })
    this.sharedGlobalNames = Object.keys(g)
    return g
  }

  globalNames(): string[] {
    if (this.sharedGlobalNames.length === 0) this.buildShared('main', {})
    return [...this.sharedGlobalNames, 'sprite', 'onClick', 'onCloneStart', 'sprites']
  }

  private compileAndRun(tab: string, source: string, globals: Record<string, unknown>): void {
    let fn: Function
    try {
      fn = new Function('__g', 'with (__g) {\n' + source + '\n}')
    } catch (err) {
      this.report(tab, err)
      return
    }
    try {
      fn(globals)
    } catch (err) {
      this.report(tab, err)
    }
  }

  run(project: RunProject): void {
    const vars: Record<string, unknown> = {}
    const facades = new Map<string, SpriteApi>()
    for (const m of this.world.sprites) {
      if (!m.isClone) facades.set(m.name, makeSpriteApi(m, this.world))
    }

    // Never spread buildShared()'s result: spreading would copy the live
    // `timer` getter as a frozen value. Assign extras onto the object instead.
    const mainGlobals = this.buildShared('main', vars)
    mainGlobals.sprites = Object.fromEntries(facades)
    this.compileAndRun('main', project.mainScript, mainGlobals)

    for (const { name, script } of project.spriteScripts) {
      const facade = facades.get(name)
      if (!facade) continue
      const g = this.buildShared(name, vars)
      g.sprite = facade
      g.onClick = (fn: unknown) =>
        this.world.bus.register(
          `click:${name}`,
          this.wrap(name, expectFunction('onClick', 'onClick(() => { ... })', fn)),
        )
      g.onCloneStart = (fn: unknown) => {
        const user = expectFunction('onCloneStart', 'onCloneStart(clone => { ... })', fn)
        this.world.bus.register(
          `clone:${name}`,
          this.wrap(name, (cloneModel: unknown) =>
            user(makeSpriteApi(cloneModel as SpriteModel, this.world)),
          ),
        )
      }
      this.compileAndRun(name, script, g)
    }

    this.world.bus.fire('start')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/runtime/executor.test.ts`
Expected: PASS. If the line-number test fails with an off-by-N, adjust `LINE_OFFSET` to match the actual V8 stack (verify by printing `err.stack` once) — the test pins the correct value.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/executor.ts src/runtime/executor.test.ts
git commit -m "feat: executor compiles user scripts with Scratch-shaped globals"
```

---

### Task 9: API definitions — single source of truth

**Files:**
- Create: `src/shared/apiDefs.ts`
- Test: `src/shared/apiDefs.test.ts`

**Interfaces:**
- Consumes: `makeSpriteApi`, `Executor.globalNames()` (coverage check only)
- Produces: `type ApiCategory`, `interface ApiDef { category: ApiCategory; name: string; signature: string; description: string; example: string; scope: 'sprite' | 'global' }`, `const API_DEFS: ApiDef[]`. Plan 2 builds the reference panel and Monaco autocomplete from this array — `description` is kid-facing copy, `example` must be paste-runnable.

- [ ] **Step 1: Write the failing test**

`src/shared/apiDefs.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { API_DEFS } from './apiDefs'
import { World } from '../runtime/world'
import { makeSpriteApi } from '../runtime/spriteApi'
import { Executor } from '../runtime/executor'

describe('API definitions', () => {
  const world = new World({
    backdrops: [{ name: 'sky', width: 480, height: 360, source: 'library:sky' }],
    soundNames: ['meow'],
  })
  const model = world.addSprite('Cat', [{ name: 'a', width: 20, height: 20, source: 'library:a' }])
  const facade = makeSpriteApi(model, world) as unknown as Record<string, unknown>
  const globals = new Executor(world, { onIssue: () => {}, onLog: () => {} }).globalNames()

  it('every def is fully written', () => {
    expect(API_DEFS.length).toBeGreaterThanOrEqual(40)
    for (const d of API_DEFS) {
      expect(d.name.length, d.name).toBeGreaterThan(0)
      expect(d.signature.length, d.name).toBeGreaterThan(0)
      expect(d.description.length, d.name).toBeGreaterThan(10)
      expect(d.example.length, d.name).toBeGreaterThan(0)
    }
  })

  it('every sprite-scoped def exists on the sprite facade', () => {
    for (const d of API_DEFS.filter(d => d.scope === 'sprite')) {
      expect(d.name in facade, `sprite.${d.name} missing`).toBe(true)
    }
  })

  it('every global-scoped def is injected by the executor', () => {
    for (const d of API_DEFS.filter(d => d.scope === 'global')) {
      const root = d.name.split('.')[0]
      expect(globals.includes(root), `global ${d.name} missing`).toBe(true)
    }
  })

  it('covers every Scratch category', () => {
    const cats = new Set(API_DEFS.map(d => d.category))
    for (const c of ['Motion', 'Looks', 'Sound', 'Events', 'Sensing', 'Control', 'Stage', 'Variables']) {
      expect(cats.has(c as never), c).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/apiDefs.test.ts`
Expected: FAIL — cannot resolve `./apiDefs`.

- [ ] **Step 3: Write the implementation**

`src/shared/apiDefs.ts` — every entry below, verbatim (kid-facing copy is part of the product):
```ts
export type ApiCategory =
  | 'Motion' | 'Looks' | 'Sound' | 'Events' | 'Sensing' | 'Control' | 'Stage' | 'Variables'

export interface ApiDef {
  category: ApiCategory
  name: string
  signature: string
  description: string
  example: string
  scope: 'sprite' | 'global'
}

export const API_DEFS: ApiDef[] = [
  // Motion
  { category: 'Motion', scope: 'sprite', name: 'move', signature: 'sprite.move(steps)', description: 'Walk forward in the direction the sprite is facing.', example: 'sprite.move(10)' },
  { category: 'Motion', scope: 'sprite', name: 'turnRight', signature: 'sprite.turnRight(degrees)', description: 'Turn clockwise by this many degrees.', example: 'sprite.turnRight(15)' },
  { category: 'Motion', scope: 'sprite', name: 'turnLeft', signature: 'sprite.turnLeft(degrees)', description: 'Turn counter-clockwise by this many degrees.', example: 'sprite.turnLeft(15)' },
  { category: 'Motion', scope: 'sprite', name: 'goTo', signature: 'sprite.goTo(x, y)', description: 'Jump straight to a spot. (0, 0) is the middle of the stage.', example: 'sprite.goTo(0, 0)' },
  { category: 'Motion', scope: 'sprite', name: 'glide', signature: 'await sprite.glide(x, y, seconds)', description: 'Slide smoothly to a spot. Use await so the next line waits for the slide to finish.', example: 'await sprite.glide(100, 100, 1)' },
  { category: 'Motion', scope: 'sprite', name: 'changeX', signature: 'sprite.changeX(amount)', description: 'Move right (or left with a negative number).', example: 'sprite.changeX(10)' },
  { category: 'Motion', scope: 'sprite', name: 'changeY', signature: 'sprite.changeY(amount)', description: 'Move up (or down with a negative number).', example: 'sprite.changeY(10)' },
  { category: 'Motion', scope: 'sprite', name: 'pointInDirection', signature: 'sprite.pointInDirection(degrees)', description: 'Face a direction: 90 is right, -90 is left, 0 is up, 180 is down.', example: 'sprite.pointInDirection(90)' },
  { category: 'Motion', scope: 'sprite', name: 'pointTowards', signature: 'sprite.pointTowards(target)', description: 'Turn to face another sprite or the mouse.', example: 'sprite.pointTowards("mouse")' },
  { category: 'Motion', scope: 'sprite', name: 'ifOnEdgeBounce', signature: 'sprite.ifOnEdgeBounce()', description: 'If the sprite is touching the edge of the stage, bounce back.', example: 'sprite.ifOnEdgeBounce()' },
  { category: 'Motion', scope: 'sprite', name: 'setRotationStyle', signature: 'sprite.setRotationStyle(style)', description: 'Choose how the sprite turns: "all around", "left-right", or "don\'t rotate".', example: 'sprite.setRotationStyle("left-right")' },
  { category: 'Motion', scope: 'sprite', name: 'x', signature: 'sprite.x', description: 'The sprite\'s left-right position. 0 is the middle.', example: 'console.log(sprite.x)' },
  { category: 'Motion', scope: 'sprite', name: 'y', signature: 'sprite.y', description: 'The sprite\'s up-down position. 0 is the middle.', example: 'console.log(sprite.y)' },
  { category: 'Motion', scope: 'sprite', name: 'direction', signature: 'sprite.direction', description: 'The direction the sprite is facing, in degrees.', example: 'console.log(sprite.direction)' },

  // Looks
  { category: 'Looks', scope: 'sprite', name: 'say', signature: 'sprite.say(text, seconds?)', description: 'Show a speech bubble. Add seconds (with await) to make it disappear after a while.', example: 'await sprite.say("Hello!", 2)' },
  { category: 'Looks', scope: 'sprite', name: 'think', signature: 'sprite.think(text, seconds?)', description: 'Show a thought bubble, like saying but with little circles.', example: 'sprite.think("Hmm...")' },
  { category: 'Looks', scope: 'sprite', name: 'switchCostume', signature: 'sprite.switchCostume(name)', description: 'Change how the sprite looks by picking one of its costumes by name.', example: 'sprite.switchCostume("cat-b")' },
  { category: 'Looks', scope: 'sprite', name: 'nextCostume', signature: 'sprite.nextCostume()', description: 'Switch to the next costume. Great for walking animations.', example: 'sprite.nextCostume()' },
  { category: 'Looks', scope: 'sprite', name: 'setSize', signature: 'sprite.setSize(percent)', description: 'Make the sprite bigger or smaller. 100 is normal size.', example: 'sprite.setSize(150)' },
  { category: 'Looks', scope: 'sprite', name: 'show', signature: 'sprite.show()', description: 'Make the sprite visible.', example: 'sprite.show()' },
  { category: 'Looks', scope: 'sprite', name: 'hide', signature: 'sprite.hide()', description: 'Make the sprite invisible. It can\'t be clicked or touched while hidden.', example: 'sprite.hide()' },
  { category: 'Looks', scope: 'sprite', name: 'setEffect', signature: 'sprite.setEffect(name, amount)', description: 'Add a visual effect: "ghost" (see-through), "brightness", or "color".', example: 'sprite.setEffect("ghost", 50)' },
  { category: 'Looks', scope: 'sprite', name: 'clearEffects', signature: 'sprite.clearEffects()', description: 'Remove all visual effects from the sprite.', example: 'sprite.clearEffects()' },
  { category: 'Looks', scope: 'sprite', name: 'goToFront', signature: 'sprite.goToFront()', description: 'Bring the sprite in front of all other sprites.', example: 'sprite.goToFront()' },
  { category: 'Looks', scope: 'sprite', name: 'goBack', signature: 'sprite.goBack(layers)', description: 'Send the sprite backwards behind other sprites.', example: 'sprite.goBack(1)' },

  // Sound
  { category: 'Sound', scope: 'global', name: 'playSound', signature: 'playSound(name)', description: 'Start playing a sound. The code keeps going while it plays.', example: 'playSound("meow")' },
  { category: 'Sound', scope: 'global', name: 'playSoundUntilDone', signature: 'await playSoundUntilDone(name)', description: 'Play a sound and wait for it to finish before the next line runs.', example: 'await playSoundUntilDone("meow")' },
  { category: 'Sound', scope: 'global', name: 'setVolume', signature: 'setVolume(percent)', description: 'Set how loud sounds are, from 0 (silent) to 100 (full).', example: 'setVolume(50)' },

  // Events
  { category: 'Events', scope: 'global', name: 'onStart', signature: 'onStart(fn)', description: 'Run this code when the green Run flag is clicked. This is how every game begins.', example: 'onStart(() => {\n  sprite.say("Game on!")\n})' },
  { category: 'Events', scope: 'global', name: 'onKeyPress', signature: 'onKeyPress(key, fn)', description: 'Run this code when a key is pressed, like "right", "left", "up", "down", "space", or a letter.', example: 'onKeyPress("right", () => {\n  sprite.changeX(10)\n})' },
  { category: 'Events', scope: 'global', name: 'onClick', signature: 'onClick(fn)', description: 'Run this code when this sprite is clicked or tapped.', example: 'onClick(() => {\n  sprite.say("Ouch!")\n})' },
  { category: 'Events', scope: 'global', name: 'onMessage', signature: 'onMessage(name, fn)', description: 'Run this code when someone broadcasts this message. Great for making sprites talk to each other.', example: 'onMessage("game-over", () => {\n  sprite.hide()\n})' },
  { category: 'Events', scope: 'global', name: 'broadcast', signature: 'broadcast(name)', description: 'Send a message to every script that is listening with onMessage.', example: 'broadcast("game-over")' },
  { category: 'Events', scope: 'global', name: 'onUpdate', signature: 'onUpdate(fn)', description: 'Run this code every frame (about 60 times a second). Use it instead of a forever loop.', example: 'onUpdate(() => {\n  if (sprite.touching("Bat")) broadcast("caught")\n})' },
  { category: 'Events', scope: 'global', name: 'onBackdropSwitch', signature: 'onBackdropSwitch(name, fn)', description: 'Run this code when the stage switches to this backdrop.', example: 'onBackdropSwitch("night", () => {\n  sprite.hide()\n})' },

  // Sensing
  { category: 'Sensing', scope: 'sprite', name: 'touching', signature: 'sprite.touching(target)', description: 'True if this sprite is touching another sprite (by name) or "edge".', example: 'if (sprite.touching("Bat")) { sprite.say("Ouch!") }' },
  { category: 'Sensing', scope: 'sprite', name: 'distanceTo', signature: 'sprite.distanceTo(target)', description: 'How far away another sprite or the "mouse" is.', example: 'if (sprite.distanceTo("mouse") < 50) { sprite.say("Too close!") }' },
  { category: 'Sensing', scope: 'global', name: 'mouse', signature: 'mouse.x, mouse.y, mouse.isDown', description: 'Where the mouse pointer is on the stage, and whether the button is pressed.', example: 'sprite.goTo(mouse.x, mouse.y)' },
  { category: 'Sensing', scope: 'global', name: 'keyIsDown', signature: 'keyIsDown(key)', description: 'True while a key is held down. Check it inside onUpdate for smooth movement.', example: 'onUpdate(() => {\n  if (keyIsDown("right")) sprite.changeX(5)\n})' },
  { category: 'Sensing', scope: 'global', name: 'timer', signature: 'timer', description: 'How many seconds have passed since the game started (or since resetTimer).', example: 'console.log(timer)' },
  { category: 'Sensing', scope: 'global', name: 'resetTimer', signature: 'resetTimer()', description: 'Set the timer back to zero.', example: 'resetTimer()' },

  // Control
  { category: 'Control', scope: 'global', name: 'wait', signature: 'await wait(seconds)', description: 'Pause this script for some seconds. Needs await in front.', example: 'await wait(1)' },
  { category: 'Control', scope: 'sprite', name: 'clone', signature: 'sprite.clone()', description: 'Make a copy of this sprite. The copy starts at the same spot.', example: 'sprite.clone()' },
  { category: 'Control', scope: 'global', name: 'onCloneStart', signature: 'onCloneStart(fn)', description: 'Run this code for each new clone. The clone is handed to your function.', example: 'onCloneStart(clone => {\n  clone.goTo(0, 0)\n})' },
  { category: 'Control', scope: 'sprite', name: 'deleteClone', signature: 'sprite.deleteClone()', description: 'Remove this clone from the stage. Only works on clones.', example: 'onCloneStart(clone => {\n  clone.deleteClone()\n})' },
  { category: 'Control', scope: 'global', name: 'stopAll', signature: 'stopAll()', description: 'Stop the whole game, like the red stop sign in Scratch.', example: 'stopAll()' },

  // Stage
  { category: 'Stage', scope: 'global', name: 'stage.switchBackdrop', signature: 'stage.switchBackdrop(name)', description: 'Change the stage background by backdrop name.', example: 'stage.switchBackdrop("night")' },
  { category: 'Stage', scope: 'global', name: 'stage.nextBackdrop', signature: 'stage.nextBackdrop()', description: 'Switch to the next backdrop in the list.', example: 'stage.nextBackdrop()' },

  // Variables
  { category: 'Variables', scope: 'global', name: 'vars', signature: 'vars.name', description: 'Shared variables every script can see. Put your score here: vars.score = 0.', example: 'vars.score = 0' },
  { category: 'Variables', scope: 'global', name: 'watch', signature: 'watch(name)', description: 'Show a shared variable on the stage so players can see it, like a score.', example: 'vars.score = 0\nwatch("score")' },
]
```

(`onClick` and `onCloneStart` carry `scope: 'global'` because they are injected globals in sprite scripts, not methods on the sprite facade — the coverage test checks them against `Executor.globalNames()`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/apiDefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run build`
Expected: all tests PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/shared/apiDefs.ts src/shared/apiDefs.test.ts
git commit -m "feat: API definitions as single source of truth"
```

---

## Done criteria for Plan 1

- `npm test` passes with tests covering: validators, clock, motion, looks, stage, events, sensing, world (input/clones/layers/sounds/snapshot), executor (happy path, runtime errors with tab+line, syntax errors, async handlers, clones), and API-def coverage.
- `npm run build` typechecks and builds.
- No imports from `src/runtime/**` to anything outside `src/runtime` and `src/shared`.
- Plan 2 (IDE frontend: React panels, Monaco, Phaser renderer, iframe protocol, assets) will consume: `World`, `Executor`, `snapshot()`, `API_DEFS`.
