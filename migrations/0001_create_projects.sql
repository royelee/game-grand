-- Mirrors the schema server/db.ts creates, so a project document is byte
-- identical in local SQLite and in D1 and a game can move between them.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  document TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
