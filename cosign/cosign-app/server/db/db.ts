// SQLite connection via Node's built-in node:sqlite — zero native deps,
// zero external services. One DB file, created by `npm run seed`.

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = join(here, "..", "..");
export const DATA_DIR = join(APP_ROOT, "server", "data");
export const DB_PATH = process.env.COSIGN_DB ?? join(DATA_DIR, "cosign.db");
export const SCHEMA_PATH = join(here, "schema.sql");

let _db: DatabaseSync | null = null;

export function openDb(path: string = DB_PATH): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

/** Shared connection for the server process. */
export function getDb(): DatabaseSync {
  if (!_db) {
    if (!existsSync(DB_PATH) && !process.env.COSIGN_DB) {
      throw new Error(
        `No database at ${DB_PATH} — run \`npm run seed\` first.`,
      );
    }
    _db = openDb();
    assertSchemaCurrent(_db);
  }
  return _db;
}

/**
 * The database file is gitignored, so it outlives the code that built it. A
 * phase that adds a table leaves every existing developer holding a database
 * that answers most routes and 500s on one — Phase 5B added `list_reranks`,
 * and `/lists/:id` threw `no such table` on a machine that had simply not
 * re-seeded. That is the missing-database guard's failure, one state over: the
 * file exists, so nothing said anything.
 *
 * Compared by name only. A column added to an existing table would still slip
 * through, but a table is what a phase adds, and a check that reads
 * `schema.sql` cannot drift away from the schema it is checking.
 */
export function missingTables(db: DatabaseSync): string[] {
  const declared = [...readFileSync(SCHEMA_PATH, "utf-8")
    .matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)]
    .map((m) => m[1]);
  const present = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      .map((r) => String((r as { name: unknown }).name)),
  );
  return declared.filter((t) => !present.has(t));
}

function assertSchemaCurrent(db: DatabaseSync): void {
  const missing = missingTables(db);
  if (missing.length) {
    // Name the command that rebuilds THIS database — a scratch DB is seeded
    // through COSIGN_DB, and being told to run the bare seed would rebuild
    // the wrong file and leave the message still true.
    const reseed = process.env.COSIGN_DB
      ? `COSIGN_DB=${process.env.COSIGN_DB} npm run seed`
      : "npm run seed";
    throw new Error(
      `Database at ${DB_PATH} was built by an older schema — missing ` +
        `${missing.length === 1 ? "table" : "tables"} ${missing.join(", ")}. ` +
        `Stop the server and run \`${reseed}\` (the file is a lock while a ` +
        `server holds it).`,
    );
  }
}

/** For tests / the seed script: a fresh DB with the schema applied. */
export function createDb(path: string): DatabaseSync {
  const db = openDb(path);
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  return db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}
