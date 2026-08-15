/**
 * A project id is a capability: whoever holds it can read and write that
 * project. 16 random bytes (22 base64url characters) is far past guessing.
 *
 * Web Crypto rather than node:crypto, and hand-rolled base64url rather than
 * Buffer, because this runs unchanged on Cloudflare Workers, which has
 * neither.
 */
export function newProjectId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
