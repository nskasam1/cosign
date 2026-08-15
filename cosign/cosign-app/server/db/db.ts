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
  }
  return _db;
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
