import { DatabaseSync } from 'node:sqlite'
import { newProjectId } from './ids.ts'

export interface StoredProject {
  id: string
  document: string
  createdAt: number
  updatedAt: number
}

/**
 * Stores project documents as opaque JSON strings. Validation happens above
 * this layer; the store's only job is durable, verbatim storage.
 */
export class ProjectStore {
  private db: DatabaseSync

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

  create(document: string, now: number): string {
    const id = newProjectId()
    this.db
      .prepare('INSERT INTO projects (id, document, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, document, now, now)
    return id
  }

  load(id: string): StoredProject | null {
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

  update(id: string, document: string, now: number): boolean {
    const result = this.db
      .prepare('UPDATE projects SET document = ?, updated_at = ? WHERE id = ?')
      .run(document, now, id)
    return Number(result.changes) > 0
  }

  close(): void {
    this.db.close()
  }
}
