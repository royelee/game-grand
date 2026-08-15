// Kept as a re-export so server/ imports do not all have to change, and so
// there is exactly one implementation to audit. The shared one uses Web
// Crypto, which Cloudflare Workers has and node:crypto's randomBytes is not.
export { newProjectId } from '../src/shared/ids.ts'
