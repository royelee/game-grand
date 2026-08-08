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
