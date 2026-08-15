import { newProjectId } from '../src/shared/ids.ts'
import type { ProjectStore, StoredProject } from '../src/shared/projectStore.ts'

interface Row {
  id: string
  document: string
  created_at: number
  updated_at: number
}

/**
 * The D1 half of the storage seam. D1 is SQLite, so these are the same three
 * statements server/db.ts runs; only the driver differs.
 *
 * `update` reads meta.changes rather than issuing a follow-up SELECT — D1
 * reports it for writes, exactly as node:sqlite reports result.changes.
 */
export class D1ProjectStore implements ProjectStore {
  constructor(private readonly db: D1Database) {}

  async create(document: string, now: number): Promise<string> {
    const id = newProjectId()
    await this.db
      .prepare('INSERT INTO projects (id, document, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(id, document, now, now)
      .run()
    return id
  }

  async load(id: string): Promise<StoredProject | null> {
    const row = await this.db
      .prepare('SELECT id, document, created_at, updated_at FROM projects WHERE id = ?')
      .bind(id)
      .first<Row>()
    if (!row) return null
    return {
      id: row.id,
      document: row.document,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async update(id: string, document: string, now: number): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE projects SET document = ?, updated_at = ? WHERE id = ?')
      .bind(document, now, id)
      .run()
    return (result.meta.changes ?? 0) > 0
  }

  /** Row count, for the storage circuit breaker. */
  async countProjects(): Promise<number> {
    const row = await this.db.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>()
    return row?.n ?? 0
  }
}
