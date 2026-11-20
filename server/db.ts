import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

/**
 * Open (and create if needed) the SQLite database.
 * Pass ":memory:" in tests. In production the file lives in DATA_DIR, i.e. on the Railway Volume.
 */
export function openDb(location: string): Db {
  const file = location === ":memory:" ? location : path.join(location, "app.db");
  const db = new Database(file);
  db.pragma("journal_mode = WAL"); // safer + faster writes; fine on a Railway volume
  db.pragma("foreign_keys = ON"); // slides are deleted with their presentation
  migrate(db);
  return db;
}

/** Tiny migration system: `PRAGMA user_version` stores how many migrations have run. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE presentations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    settings   TEXT NOT NULL DEFAULT '{}',  -- JSON: styling + video choice (added in step d)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE slides (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    presentation_id INTEGER NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,        -- 0-based, always contiguous within a presentation
    lyrics          TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT ''  -- private, shown on the control panel only
  );
  CREATE INDEX slides_by_presentation ON slides(presentation_id, position);
  `,
  `
  -- Uploaded background videos. The file itself lives in DATA_DIR/videos/<filename>.
  CREATE TABLE videos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,  -- never reused, so /media/<id> can be cached forever
    name       TEXT NOT NULL,
    filename   TEXT NOT NULL UNIQUE,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Small key/value store; currently holds the live state so a restart resumes where we were.
  CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

function migrate(db: Db) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
