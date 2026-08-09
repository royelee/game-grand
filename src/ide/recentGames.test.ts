import { describe, it, expect, beforeEach } from 'vitest'
import { MAX_RECENT_GAMES, forgetGame, readRecent, rememberGame } from './recentGames'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

let storage: Storage
beforeEach(() => {
  storage = fakeStorage()
})

describe('recent games', () => {
  it('starts empty and survives junk in storage', () => {
    expect(readRecent(storage)).toEqual([])
    storage.setItem('game-grand:recent', 'not json')
    expect(readRecent(storage)).toEqual([])
  })

  it('remembers newest first', () => {
    rememberGame(storage, { id: 'a', name: 'A', savedAt: 1 })
    rememberGame(storage, { id: 'b', name: 'B', savedAt: 2 })
    expect(readRecent(storage).map(g => g.id)).toEqual(['b', 'a'])
  })

  it('moves a re-saved game to the front instead of duplicating it', () => {
    rememberGame(storage, { id: 'a', name: 'A', savedAt: 1 })
    rememberGame(storage, { id: 'b', name: 'B', savedAt: 2 })
    rememberGame(storage, { id: 'a', name: 'A renamed', savedAt: 3 })
    const recent = readRecent(storage)
    expect(recent.map(g => g.id)).toEqual(['a', 'b'])
    expect(recent[0].name).toBe('A renamed')
  })

  it('caps the list', () => {
    for (let i = 0; i < MAX_RECENT_GAMES + 5; i++) {
      rememberGame(storage, { id: `g${i}`, name: `G${i}`, savedAt: i })
    }
    const recent = readRecent(storage)
    expect(recent).toHaveLength(MAX_RECENT_GAMES)
    expect(recent[0].id).toBe(`g${MAX_RECENT_GAMES + 4}`)
  })

  it('forgets one game', () => {
    rememberGame(storage, { id: 'a', name: 'A', savedAt: 1 })
    rememberGame(storage, { id: 'b', name: 'B', savedAt: 2 })
    forgetGame(storage, 'a')
    expect(readRecent(storage).map(g => g.id)).toEqual(['b'])
  })

  it('survives a storage that refuses to write', () => {
    const full: Storage = {
      get length() { return 0 },
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new DOMException('QuotaExceededError')
      },
    }
    expect(() => rememberGame(full, { id: 'a', name: 'A', savedAt: 1 })).not.toThrow()
    expect(() => forgetGame(full, 'a')).not.toThrow()
  })
})
