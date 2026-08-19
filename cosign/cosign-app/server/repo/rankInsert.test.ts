// @vitest-environment node
//
// Binary-search insertion, end to end through POST /api/rankings/insert.
// Two things are easy to lose here: the `rankings` row that carries the
// list's visibility (decision 9) and the "last put in order" stamp, and the
// fact that every comparison lands in the same transaction as the entries —
// so one bad shop id has to be refused before the transaction opens, not
// discovered inside it. The tests run in order against one list.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "cosign-rank-"));
const dbPath = join(dir, "test.db");
// db.ts reads COSIGN_DB at module load, so these imports must be dynamic —
// a static one is hoisted above this line and opens the real database.
process.env.COSIGN_DB = dbPath;

const { createDb, getDb, closeDb } = await import("../db/db");
createDb(dbPath).close();
const db = getDb();

const { app } = await import("../index");
const { makeSessionCookie } = await import("../auth/cookie");

db.exec(`INSERT INTO schools (id, name) VALUES ('osu', 'Ohio State University');`);
db.prepare(
  "INSERT INTO users (id, username, display_name, school_id, created_at) VALUES (?,?,?,?,?)",
).run("u_me", "me", "Me", "osu", "2026-01-01T00:00:00Z");
const insShop = db.prepare(
  "INSERT INTO shops (id, slug, name, address, lat, lng, school_id, student_discount, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
);
for (const s of ["a", "b", "c", "d", "e"]) {
  insShop.run(`s_${s}`, s, `Shop ${s.toUpperCase()}`, "1 High St", 40, -83, "osu", 0, "2026-01-01T00:00:00Z");
}

const session = makeSessionCookie("u_me").split(";")[0];

interface Insert {
  shop_id: string;
  position: number;
  comparisons?: Array<{ winner_shop_id: string; loser_shop_id: string }>;
}

const insert = (body: Insert) =>
  app.fetch(
    new Request("http://localhost/api/rankings/insert", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session },
      body: JSON.stringify(body),
    }),
  );

const count = (sql: string) => (db.prepare(`SELECT count(*) n FROM ${sql}`).get() as { n: number }).n;
const order = () =>
  (
    db
      .prepare("SELECT shop_id, position FROM ranking_entries WHERE user_id = 'u_me' ORDER BY position")
      .all() as unknown as Array<{ shop_id: string; position: number }>
  );
const ranking = () =>
  db.prepare("SELECT * FROM rankings WHERE user_id = 'u_me'").get() as
    | { visibility: string; updated_at: string; title: string | null }
    | undefined;

describe("the ranking row is created by the insertion that needs it", () => {
  it("a first-ever insertion writes it, friends-only", async () => {
    expect(ranking()).toBeUndefined();
    expect((await insert({ shop_id: "s_a", position: 1 })).status).toBe(201);
    expect(order().map((e) => e.shop_id)).toEqual(["s_a"]);
    expect(ranking()?.visibility).toBe("friends");
    expect(count("rankings")).toBe(1);
  });

  it("a second insertion moves updated_at without duplicating the row", async () => {
    db.exec("UPDATE rankings SET updated_at = '2020-01-01T00:00:00.000Z' WHERE user_id = 'u_me'");
    const res = await insert({
      shop_id: "s_b",
      position: 2,
      comparisons: [{ winner_shop_id: "s_a", loser_shop_id: "s_b" }],
    });
    expect(res.status).toBe(201);
    expect(count("rankings")).toBe(1);
    expect(ranking()!.updated_at > "2020-01-01T00:00:00.000Z").toBe(true);
  });
});

describe("a bad comparison is refused before anything is written", () => {
  it("rejects a shop compared with itself", async () => {
    const before = order();
    const res = await insert({
      shop_id: "s_c",
      position: 1,
      comparisons: [{ winner_shop_id: "s_c", loser_shop_id: "s_c" }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad comparison" });
    expect(order()).toEqual(before);
    expect(count("comparisons")).toBe(1);
  });

  it("rejects an unknown shop id in a comparison", async () => {
    const before = order();
    const res = await insert({
      shop_id: "s_c",
      position: 1,
      comparisons: [{ winner_shop_id: "s_c", loser_shop_id: "s_nope" }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown shop in comparison" });
    expect(order()).toEqual(before);
    expect(count("analytics_events WHERE event = 'ranking_inserted'")).toBe(2); // the two that succeeded
  });
});

describe("re-ranking an existing shop", () => {
  it("first, insert it at the tail", async () => {
    const res = await insert({
      shop_id: "s_c",
      position: 3,
      comparisons: [
        { winner_shop_id: "s_a", loser_shop_id: "s_c" },
        { winner_shop_id: "s_b", loser_shop_id: "s_c" },
      ],
    });
    expect(res.status).toBe(201);
    expect(order().map((e) => e.shop_id)).toEqual(["s_a", "s_b", "s_c"]);
    expect(count("comparisons WHERE context = 'reorder'")).toBe(0);
  });

  it("moves it without duplicating it, and logs the taps as a reorder", async () => {
    const res = await insert({
      shop_id: "s_c",
      position: 1,
      comparisons: [{ winner_shop_id: "s_c", loser_shop_id: "s_a" }],
    });
    expect(res.status).toBe(201);
    expect(order()).toEqual([
      { shop_id: "s_c", position: 1 },
      { shop_id: "s_a", position: 2 },
      { shop_id: "s_b", position: 3 },
    ]);
    expect(count("comparisons WHERE context = 'reorder'")).toBe(1);
  });
});

describe("the insertion is recorded locally", () => {
  it("fires ranking_inserted with the shop and the number of taps it took", async () => {
    const before = count("analytics_events WHERE event = 'ranking_inserted'");
    const res = await insert({
      shop_id: "s_d",
      position: 1,
      comparisons: [{ winner_shop_id: "s_d", loser_shop_id: "s_c" }],
    });
    expect(res.status).toBe(201);
    expect(count("analytics_events WHERE event = 'ranking_inserted'")).toBe(before + 1);
    const row = db
      .prepare("SELECT user_id, props_json FROM analytics_events WHERE event = 'ranking_inserted' ORDER BY id DESC LIMIT 1")
      .get() as { user_id: string; props_json: string };
    expect(row.user_id).toBe("u_me");
    expect(JSON.parse(row.props_json)).toEqual({ shop_id: "s_d", comparisons: 1 });
  });
});

describe("the upsert never re-closes a list its owner opened", () => {
  it("a ranking already made public stays public", async () => {
    db.exec("UPDATE rankings SET visibility = 'public' WHERE user_id = 'u_me'");
    expect((await insert({ shop_id: "s_e", position: 5 })).status).toBe(201);
    expect(ranking()!.visibility).toBe("public");
  });
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
