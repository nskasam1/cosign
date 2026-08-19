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
import { execFileSync } from "node:child_process";
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

// ── Phase 9.2 ──────────────────────────────────────────────────────────────
//
// Everything above tests `missingTables`, which was always correct. What was
// not correct was how `getDb()` USED it, and a database predating Phase 9's
// `credentials` table exposed two holes on 2026-08-18:
//
//   1. `getDb()` cached the connection BEFORE validating it, so the first call
//      threw and every call after it got the cached handle back unchecked. The
//      guard fired exactly once and then stopped guarding — `/api/meta`
//      returned 500, then 200 on the retry. That is worse than no guard: the
//      server answers almost everything and 500s only on the routes that touch
//      the new table, which is the confusing failure Phase 6 wrote it to stop.
//   2. `getDb()` is lazy, so nothing was checked until the first request that
//      needed the database. The process printed `cosign server (prod) on
//      http://localhost:8787` and looked completely healthy while holding a
//      database it could not use — and CLAUDE.md had claimed a startup check
//      since Phase 6. `assertSchemaAtStartup()` is what makes that true.

/** A database built by an older schema: the current one, minus one table. */
function staleDb(dropped: string): string {
  const path = tmp();
  const db = createDb(path);
  db.exec(`DROP TABLE IF EXISTS ${dropped}`);
  db.close();
  return path;
}

/**
 * `getDb()` is module-level singleton state, so these run it in a child
 * process with COSIGN_DB pointed at a stale file. Importing it here and
 * poking `_db` would test a mock of the bug rather than the bug.
 */
function runGetDb(dbPath: string, times: number): { code: number; out: string } {
  const script = `
    import { getDb } from ${JSON.stringify(new URL("./db.ts", import.meta.url).href)};
    let threw = 0;
    for (let i = 0; i < ${times}; i++) {
      try { getDb(); console.log("call" + i + ":ok"); }
      catch (e) { threw++; console.log("call" + i + ":threw:" + (e.message.split("—")[1] ?? "").trim().slice(0, 40)); }
    }
    console.log("threwCount:" + threw);
  `;
  try {
    const out = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      env: { ...process.env, COSIGN_DB: dbPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

describe("the guard keeps guarding", () => {
  it("throws on EVERY call against a stale database, not just the first", () => {
    const path = staleDb("credentials");
    const { out } = runGetDb(path, 3);
    // This is the regression. Before the fix the output was
    // call0:threw / call1:ok / call2:ok — the handle was cached before the
    // check, so the second call skipped it and the server carried on.
    expect(out).toContain("threwCount:3");
    expect(out).not.toContain(":ok");
  });

  it("names the missing table and the command that rebuilds this database", () => {
    const path = staleDb("webauthn_challenges");
    const { out } = runGetDb(path, 1);
    expect(out).toContain("webauthn_challenges");
  });

  it("returns the same handle on repeat calls when the schema IS current", () => {
    const path = tmp();
    createDb(path).close();
    const { out } = runGetDb(path, 3);
    expect(out).toContain("call0:ok");
    expect(out).toContain("call2:ok");
    expect(out).toContain("threwCount:0");
  });
});
