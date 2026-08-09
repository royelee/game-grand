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

/**
 * Writes are best-effort. A full localStorage (Safari private browsing, a
 * constrained device) throws QuotaExceededError, and losing this convenience
 * list must never take down a save that already succeeded on the server —
 * the link is the real key to a game, not this list.
 */
function write(storage: Storage, games: RecentGame[]): void {
  try {
    storage.setItem(KEY, JSON.stringify(games))
  } catch {
    // Ignore: the list is a nicety, the game is already safe on the server.
  }
}

export function rememberGame(storage: Storage, game: RecentGame): void {
  const next = [game, ...readRecent(storage).filter(g => g.id !== game.id)].slice(
    0,
    MAX_RECENT_GAMES,
  )
  write(storage, next)
}

export function forgetGame(storage: Storage, id: string): void {
  write(storage, readRecent(storage).filter(g => g.id !== id))
}
