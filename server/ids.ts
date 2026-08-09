import { randomBytes } from 'node:crypto'

/**
 * A project id is a capability: whoever holds it can read and write that
 * project. 16 random bytes (22 base64url characters) is far past guessing.
 */
export function newProjectId(): string {
  return randomBytes(16).toString('base64url')
}
