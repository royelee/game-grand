import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteProjectStore } from './db.ts'

const doc = (name: string) => JSON.stringify({ version: 1, name })

let store: SqliteProjectStore

beforeEach(() => {
  store = new SqliteProjectStore(':memory:')
})
afterEach(() => {
  store.close()
})

describe('SqliteProjectStore', () => {
  it('creates a project and reads it back', async () => {
    const id = await store.create(doc('Cat Chase'), 1000)
    const found = await store.load(id)
    expect(found).toMatchObject({ id, document: doc('Cat Chase'), createdAt: 1000, updatedAt: 1000 })
  })

  it('returns null for an unknown id', async () => {
    expect(await store.load('nope')).toBeNull()
  })

  it('updates a project and moves updatedAt but not createdAt', async () => {
    const id = await store.create(doc('First'), 1000)
    expect(await store.update(id, doc('Second'), 2000)).toBe(true)
    expect(await store.load(id)).toMatchObject({
      document: doc('Second'),
      createdAt: 1000,
      updatedAt: 2000,
    })
  })

  it('reports an update to an unknown id instead of creating one', async () => {
    expect(await store.update('nope', doc('x'), 1000)).toBe(false)
    expect(await store.load('nope')).toBeNull()
  })

  it('keeps projects independent', async () => {
    const a = await store.create(doc('A'), 1)
    const b = await store.create(doc('B'), 2)
    expect(a).not.toBe(b)
    await store.update(a, doc('A2'), 3)
    expect((await store.load(b))?.document).toBe(doc('B'))
  })

  it('stores documents verbatim, including awkward characters', async () => {
    const tricky = JSON.stringify({ version: 1, name: 'it\'s "quoted" — ☃', mainScript: 'a\nb' })
    const id = await store.create(tricky, 1)
    expect((await store.load(id))?.document).toBe(tricky)
  })
})
