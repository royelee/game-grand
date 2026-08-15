export interface StoredProject {
  id: string
  document: string
  createdAt: number
  updatedAt: number
}

/**
 * Durable, verbatim storage of project documents as opaque JSON strings.
 * Validation happens above this layer.
 *
 * Async because D1 is: the Cloudflare backend cannot be synchronous, and one
 * interface for both backends is the whole point. `update` returns whether a
 * row matched, which both backends report without a follow-up SELECT
 * (node:sqlite `result.changes`, D1 `meta.changes`).
 */
export interface ProjectStore {
  create(document: string, now: number): Promise<string>
  load(id: string): Promise<StoredProject | null>
  update(id: string, document: string, now: number): Promise<boolean>
}
