// @vitest-environment node
//
// The three promises the brief calls integrity (#12), tested as properties of
// the shipped API rather than as claims in a document:
//
//   1. lists, logs and rankings are friends-only unless somebody opts out;
//   2. no geolocation coordinate is ever persisted, by any route;
//   3. rank can never be bought — there is no surface, column or field
//      anywhere that moves a place up somebody's page for any reason other
//      than a person putting it there.
//
// Phase 4's discover.test.ts checks (2) for Home; this checks every route
// that takes a position, including the ones Phase 5B added, and it checks
// the other two across the whole surface.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "cosign-integrity-"));
const dbPath = join(dir, "seeded.db");
process.env.COSIGN_DB = dbPath;

const { closeDb, getDb } = await import("../db/db");
afterAll(() => {
  closeDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the OS will clear its own temp directory */
  }
});
const { runSeed, DEFAULT_SEED_DIR } = await import("../db/seed");
const { app } = await import("../index");
const { makeSessionCookie } = await import("../auth/cookie");

runSeed(dbPath, DEFAULT_SEED_DIR);
const db = getDb();

const cookie = (userId: string) => makeSessionCookie(userId).split(";")[0];
const call = (path: string, init: RequestInit & { as?: string } = {}) => {
  const { as, ...rest } = init;
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...rest,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(as ? { Cookie: cookie(as) } : {}),
      },
    }),
  );
};
const post = (path: string, body: unknown, as?: string) =>
  call(path, { method: "POST", body: JSON.stringify(body), as });

const tables = () =>
  (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as unknown as Array<{ name: string }>
  ).map((t) => t.name);

const columnsOf = (table: string) =>
  (db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as Array<{ name: string }>).map((c) => c.name);

// ── 1. friends-only by default ─────────────────────────────────────────────

describe("friends-only is the default, and the client cannot talk its way out", () => {
  it("the columns default to friends, not to public", () => {
    for (const table of ["lists", "logs", "rankings"]) {
      const row = db
        .prepare(`SELECT dflt_value AS d FROM pragma_table_info('${table}') WHERE name = 'visibility'`)
        .get() as { d: string } | undefined;
      expect(row?.d, table).toBe("'friends'");
    }
  });

  it("a log posted as public is stored friends-only anyway", async () => {
    const res = await post(
      "/api/logs",
      { shop_id: "s_bramble", intent_tag: "reading", visibility: "public", user_id: "u_maya" },
      "u_lena",
    );
    expect(res.status).toBe(201);
    const { log } = (await res.json()) as { log: { id: string; visibility: string; user_id: string } };
    expect(log.visibility).toBe("friends");
    // …and is the poster's own, whatever the body said
    expect(log.user_id).toBe("u_lena");
  });

  it("a list created through the API is friends-only, whatever the body says", async () => {
    const res = await post("/api/lists", { title: "not public", visibility: "public" }, "u_lena");
    const { list } = (await res.json()) as { list: { id: string; visibility: string } };
    expect(list.visibility).toBe("friends");
    // and a stranger cannot even tell it exists
    expect((await call(`/api/lists/${list.id}`, { as: "u_sam" })).status).toBe(404);
    expect((await call(`/api/lists/${list.id}`)).status).toBe(404);
    expect((await call(`/api/lists/${list.id}`, { as: "u_lena" })).status).toBe(200);
  });

  it("a ranking built through the API is friends-only", async () => {
    const created = await post("/api/auth/create", { username: `int${Date.now().toString(36)}`, display_name: "Int" });
    const { user } = (await created.json()) as { user: { id: string; username: string } };
    await post("/api/rankings/insert", { shop_id: "s_bramble", position: 1, comparisons: [] }, user.id);
    const row = db.prepare("SELECT visibility FROM rankings WHERE user_id = ?").get(user.id) as {
      visibility: string;
    };
    expect(row.visibility).toBe("friends");
    // the in-app profile route agrees
    const seen = (await (await call(`/api/users/${user.username}`, { as: "u_sam" })).json()) as {
      can_see_ranking: boolean;
      entries: unknown[];
    };
    expect(seen.can_see_ranking).toBe(false);
    expect(seen.entries).toEqual([]);
  });

  it("the seeded data is friends-only except where a fixture says otherwise", () => {
    for (const table of ["lists", "logs", "rankings"]) {
      const counts = db
        .prepare(`SELECT visibility, count(*) AS n FROM ${table} GROUP BY visibility`)
        .all() as unknown as Array<{ visibility: string; n: number }>;
      const friends = counts.find((c) => c.visibility === "friends")?.n ?? 0;
      const publics = counts.find((c) => c.visibility === "public")?.n ?? 0;
      expect(friends, table).toBeGreaterThan(publics);
    }
  });

  it("nothing Phase 5B added opens a friends-only record to a stranger", async () => {
    // a group session names its own members and the places on the table, and
    // nothing else about anybody
    const start = await post("/api/group", { invite: ["dev"] }, "u_maya");
    const { session } = (await start.json()) as { session: { id: string } };
    await post(`/api/group/${session.id}/needs`, { participant_token: "pt-integrity-01" }, "u_maya");
    const view = (await (await call(`/api/group/${session.id}`)).json()) as {
      members: Record<string, string>;
      picks: Array<{ positions: Array<{ user_id: string }> }>;
    };
    const named = new Set(view.picks.flatMap((p) => p.positions.map((x) => x.user_id)));
    for (const uid of named) expect(Object.keys(view.members)).toContain(uid);

    // a notification feed is one person's
    expect((await call("/api/notifications")).status).toBe(401);
  });
});

// ── 2. no persistent location history ──────────────────────────────────────

describe("a coordinate is read momentarily and written nowhere", () => {
  it("no table has a column that could hold one, outside the shops' own address", () => {
    for (const table of tables()) {
      for (const col of columnsOf(table)) {
        if (table === "shops" && (col === "lat" || col === "lng")) continue; // the shop's own address
        // `position` is deliberately not in this list: a rank position is
        // not a place on the earth, and the two words collide.
        expect(/^(lat|lng|latitude|longitude|coords?|geo|geohash|last_seen_at)$/i.test(col), `${table}.${col}`).toBe(
          false,
        );
      }
    }
  });

  it("every route that takes a position stores none of it", async () => {
    const needle = "41.987654";
    const lng = "-87.123456";
    const start = await post("/api/group", { invite: [] }, "u_maya");
    const { session } = (await start.json()) as { session: { id: string } };
    await post(`/api/group/${session.id}/needs`, { participant_token: "pt-position-01" }, "u_maya");

    await call(`/api/discover?lat=${needle}&lng=${lng}`);
    await call(`/api/discover?lat=${needle}&lng=${lng}`, { as: "u_maya" });
    await call(`/api/group/${session.id}?lat=${needle}&lng=${lng}`);
    await call(`/api/group/${session.id}?lat=${needle}&lng=${lng}&pt=pt-position-01`, { as: "u_maya" });

    for (const table of tables()) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM "${table}"`).all());
      expect(dump.includes(needle), `latitude found in ${table}`).toBe(false);
      expect(dump.includes("87.123456"), `longitude found in ${table}`).toBe(false);
    }
  });

  it("and the analytics table has no room for one either", () => {
    const rows = db.prepare("SELECT props_json FROM analytics_events").all() as unknown as Array<{
      props_json: string;
    }>;
    for (const r of rows) expect(r.props_json).not.toMatch(/\b(lat|lng|latitude|longitude)\b/i);
  });
});

// ── 3. rank can never be bought ────────────────────────────────────────────

describe("there is no path that buys a place a better position", () => {
  it("no table carries a column that could hold a payment or a promotion", () => {
    const banned = /(sponsor|promot|boost|featured|placement|advert|campaign|paid|payment|billing|tier|priority|weight|rank_override)/i;
    for (const table of tables()) {
      for (const col of columnsOf(table)) {
        expect(banned.test(col), `${table}.${col}`).toBe(false);
      }
    }
  });

  it("no write route accepts a field that moves a place, however it is spelled", async () => {
    const before = await (await call("/api/discover", { as: "u_maya" })).json();
    const order = (v: unknown) => (v as { entries: Array<{ id: string }> }).entries.map((e) => e.id);
    const bribe = {
      sponsored: true,
      promoted: true,
      boost: 999,
      rank: 1,
      position: 1,
      featured: true,
      weight: 1000,
      paid: 4999,
      priority: "high",
    };

    // every write surface in the product, handed the same bribe
    await post("/api/logs", { shop_id: "s_bramble", intent_tag: "reading", ...bribe }, "u_maya");
    await post("/api/events", { event: "app_open", props: bribe }, "u_maya");
    await post("/api/lists", { title: "bribe", ...bribe }, "u_maya");
    await post("/api/shops/s_bramble/verify", bribe, "u_maya");
    await post("/api/group", { invite: [], ...bribe }, "u_maya");
    await post("/api/friends/request", { username: "sam", ...bribe }, "u_lena");

    const after = await (await call("/api/discover", { as: "u_maya" })).json();
    expect(order(after)).toEqual(order(before));
  });

  it("the only thing that moves a place is a person putting it in their own list", async () => {
    const orderFor = async (as: string) =>
      ((await (await call("/api/discover", { as })).json()) as { entries: Array<{ id: string }> }).entries.map(
        (e) => e.id,
      );
    const devBefore = await orderFor("u_dev");
    const lenaBefore = await orderFor("u_lena");

    // u_lena ranks Bramble at the top of her own list
    const res = await post(
      "/api/rankings/insert",
      { shop_id: "s_bramble", position: 1, comparisons: [] },
      "u_lena",
    );
    expect(res.status).toBe(201);

    // her own page moves…
    expect(await orderFor("u_lena")).not.toEqual(lenaBefore);
    // …and somebody who is not her friend sees exactly what they saw before
    expect(await orderFor("u_dev")).toEqual(devBefore);
  });

  it("and there is no route that edits a shop at all, beyond confirming its facts", async () => {
    for (const [method, path] of [
      ["POST", "/api/shops"],
      ["POST", "/api/shops/s_bramble"],
      ["PATCH", "/api/shops/s_bramble"],
      ["PUT", "/api/shops/s_bramble"],
      ["DELETE", "/api/shops/s_bramble"],
      ["POST", "/api/shops/s_bramble/promote"],
      ["POST", "/api/shops/s_bramble/rank"],
    ] as const) {
      const res = await call(path, { method, body: JSON.stringify({ position: 1 }), as: "u_maya" });
      expect([404, 405], `${method} ${path}`).toContain(res.status);
    }
  });
});
