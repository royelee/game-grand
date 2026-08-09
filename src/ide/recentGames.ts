export interface RecentGame {
  id: string
  name: string
  savedAt: number
}

export const MAX_RECENT_GAMES = 12
const KEY = 'game-grand:recent'

/**
 * A local convenience list only — the link is the real key to a game. Anything
 * unreadable in storage is treated as an empty list rather than an error: a
 * corrupt list must never stop a kid from opening their game.
 */
export function readRecent(storage: Storage): RecentGame[] {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (g): g is RecentGame =>
        typeof g?.id === 'string' && typeof g?.name === 'string' && typeof g?.savedAt === 'number',
    )
  } catch {
    return []
  }
}

export function rememberGame(storage: Storage, game: RecentGame): void {
  const next = [game, ...readRecent(storage).filter(g => g.id !== game.id)].slice(
    0,
    MAX_RECENT_GAMES,
  )
  storage.setItem(KEY, JSON.stringify(next))
}

export function forgetGame(storage: Storage, id: string): void {
  storage.setItem(KEY, JSON.stringify(readRecent(storage).filter(g => g.id !== id)))
}
