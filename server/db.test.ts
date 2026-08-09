import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ProjectStore } from './db.ts'

const doc = (name: string) => JSON.stringify({ version: 1, name })

let store: ProjectStore

beforeEach(() => {
  store = new ProjectStore(':memory:')
})
afterEach(() => {
  store.close()
})

describe('ProjectStore', () => {
  it('creates a project and reads it back', () => {
    const id = store.create(doc('Cat Chase'), 1000)
    const found = store.load(id)
    expect(found).toMatchObject({ id, document: doc('Cat Chase'), createdAt: 1000, updatedAt: 1000 })
  })

  it('returns null for an unknown id', () => {
    expect(store.load('nope')).toBeNull()
  })

  it('updates a project and moves updatedAt but not createdAt', () => {
    const id = store.create(doc('First'), 1000)
    expect(store.update(id, doc('Second'), 2000)).toBe(true)
    expect(store.load(id)).toMatchObject({
      document: doc('Second'),
      createdAt: 1000,
      updatedAt: 2000,
    })
  })

  it('reports an update to an unknown id instead of creating one', () => {
    expect(store.update('nope', doc('x'), 1000)).toBe(false)
    expect(store.load('nope')).toBeNull()
  })

  it('keeps projects independent', () => {
    const a = store.create(doc('A'), 1)
    const b = store.create(doc('B'), 2)
    expect(a).not.toBe(b)
    store.update(a, doc('A2'), 3)
    expect(store.load(b)?.document).toBe(doc('B'))
  })

  it('stores documents verbatim, including awkward characters', () => {
    const tricky = JSON.stringify({ version: 1, name: 'it\'s "quoted" — ☃', mainScript: 'a\nb' })
    const id = store.create(tricky, 1)
    expect(store.load(id)?.document).toBe(tricky)
  })
})
