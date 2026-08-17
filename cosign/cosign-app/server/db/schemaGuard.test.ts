// @vitest-environment node
//
// The database file is gitignored, so it outlives the code that built it.
// Every phase that has added a table has silently invalidated every existing
// developer's database — and the failure did not look like one. Phase 5B
// added `list_reranks`; on a machine that had not re-seeded, `/lists/:id`
// answered 500 `no such table` while every other route answered fine, and
// the SPA's list page showed its "cannot reach the server" state. That is the
// missing-database guard's job, one state over: the file existed, so nothing
// said anything.
//
// The guard reads `schema.sql` rather than a hand-kept list, so it cannot
// drift away from the schema it checks. These tests hold both directions: a
// freshly created database is current, and a database missing a table names
// exactly that table.

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDb, missingTables } from "./db.ts";

function tmp(): string {
  return join(mkdtempSync(join(tmpdir(), "cosign-schema-")), "x.db");
}

describe("stale-database guard", () => {
  it("finds nothing missing in a database the schema just built", () => {
    const path = tmp();
    const db = createDb(path);
    try {
      expect(missingTables(db)).toEqual([]);
    } finally {
      db.close();
      rmSync(path, { force: true });
    }
  });

  it("names the table a pre-Phase-5B database is missing", () => {
    // The real defect, reproduced: everything except `list_reranks`.
    const path = tmp();
    const full = createDb(path);
    const tables = full.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'list_reranks'" +
        " AND name NOT LIKE 'sqlite_%'", // sqlite_sequence is SQLite's own, and cannot be created by hand
    ).all().map((r) => String((r as { name: unknown }).name));
    full.close();

    const stalePath = tmp();
    const stale = new DatabaseSync(stalePath);
    try {
      // Names only — the guard compares names, so empty tables are enough.
      for (const t of tables) stale.exec(`CREATE TABLE ${t} (x)`);
      expect(missingTables(stale)).toEqual(["list_reranks"]);
    } finally {
      stale.close();
      rmSync(path, { force: true });
      rmSync(stalePath, { force: true });
    }
  });

  it("reports every missing table, not just the first", () => {
    const path = tmp();
    const db = new DatabaseSync(path);
    try {
      const missing = missingTables(db);
      expect(missing).toContain("shops");
      expect(missing).toContain("list_reranks");
      expect(missing.length).toBeGreaterThan(15);
    } finally {
      db.close();
      rmSync(path, { force: true });
    }
  });
});
