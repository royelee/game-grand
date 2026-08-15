import { createRequire } from 'node:module'
import { newProjectId } from './ids.ts'
import type { ProjectStore, StoredProject } from '../src/shared/projectStore.ts'

// Loaded through createRequire rather than a static import: Vite (which powers
// Vitest) strips the `node:` prefix from builtins it doesn't know about and
// then fails to resolve a bare `sqlite`, which would leave this file untestable.
// createRequire is not statically analysed, so it works under both plain Node
// and Vitest.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (filename: string) => {
    exec(sql: string): void
    prepare(sql: string): {
      run(...params: unknown[]): { changes: number | bigint }
      get(...params: unknown[]): unknown
    }
    close(): void
  }
}

export type { StoredProject }

/**
 * Stores project documents as opaque JSON strings. Validation happens above
 * this layer; the store's only job is durable, verbatim storage.
 *
 * The methods are async only because the interface is: D1, the Cloudflare
 * backend behind the same interface, cannot be synchronous. DatabaseSync
 * underneath is still synchronous.
 */
export class SqliteProjectStore implements ProjectStore {
  private db: InstanceType<typeof DatabaseSync>

  constructor(filename: string) {
    this.db = new DatabaseSync(filename)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        document TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  async create(document: string, now: number): Promise<string> {
    const id = newProjectId()
    this.db
      .prepare('INSERT INTO projects (id, document, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, document, now, now)
    return id
  }

  async load(id: string): Promise<StoredProject | null> {
    const row = this.db
      .prepare('SELECT id, document, created_at, updated_at FROM projects WHERE id = ?')
      .get(id) as
      | { id: string; document: string; created_at: number; updated_at: number }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      document: row.document,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async update(id: string, document: string, now: number): Promise<boolean> {
    const result = this.db
      .prepare('UPDATE projects SET document = ?, updated_at = ? WHERE id = ?')
      .run(document, now, id)
    return Number(result.changes) > 0
  }

  close(): void {
    this.db.close()
  }
}
