// @vitest-environment node
//
// The two aggregates behind Home: the crowd baseline and the friend-weighted
// score. Both are aggregated RANK — the mean percentile position a place
// holds across people's ordered lists — because there is no rating in this
// product to average (decision 8).
//
// The order those scores produce, and the guarantee that friends outrank the
// crowd, are tested one level up in discover.test.ts, against the function
// the route actually calls.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, openDb } from "../db/db";
import { runSeed, DEFAULT_SEED_DIR } from "../db/seed";
import { crowdScores, friendScores, friendSignals, orderOf } from "./scores";

const dir = mkdtempSync(join(tmpdir(), "cosign-scores-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;

/**
 * A synthetic campus where the mechanism is unambiguous:
 *   s_crowd    — every stranger's #1; nobody the viewer knows has been
 *   s_friend   — the viewer's one friend's #1, and every stranger's last
 *   s_friend_2 — the same friend's last, and nobody else has heard of it
 */
function campus(strangers: number) {
  const db = createDb(join(dir, `campus-${n++}.db`));
  db.exec(`INSERT INTO schools (id, name) VALUES ('osu','Ohio State University');`);
  const addUser = db.prepare(
    "INSERT INTO users (id, username, display_name, school_id, created_at) VALUES (?,?,?,'osu','2026-01-01T00:00:00Z')",
  );
  const addShop = db.prepare(
    "INSERT INTO shops (id, slug, name, address, lat, lng, school_id, student_discount, created_at) VALUES (?,?,?,'1 High St',40,-83,'osu',0,'2026-01-01T00:00:00Z')",
  );
  const addEntry = db.prepare(
    "INSERT INTO ranking_entries (user_id, shop_id, position, inserted_at) VALUES (?,?,?,'2026-01-01T00:00:00Z')",
  );

  for (const u of ["u_me", "u_pal"]) addUser.run(u, u.slice(2), u);
  for (const s of ["s_crowd", "s_friend", "s_friend_2"]) addShop.run(s, s.slice(2), s);
  db.prepare(
    "INSERT INTO friendships (id, user_id, friend_id, status, created_at) VALUES ('f1','u_me','u_pal','accepted','2026-01-01T00:00:00Z')",
  ).run();

  addEntry.run("u_pal", "s_friend", 1);
  addEntry.run("u_pal", "s_friend_2", 2);
  for (let i = 0; i < strangers; i++) {
    const id = `u_x${i}`;
    addUser.run(id, `x${i}`, id);
    addEntry.run(id, "s_crowd", 1);
    addEntry.run(id, "s_friend", 2);
  }
  return db;
}

describe("the crowd baseline", () => {
  it("is a mean rank percentile, where 1.0 is everyone's number one", () => {
    const db = campus(1);
    const crowd = crowdScores(db);
    expect(crowd.get("s_crowd")!.score).toBeCloseTo(1, 6); // the stranger's #1 of 2
    expect(crowd.get("s_friend")!.score).toBeCloseTo(0.5, 6); // one #1, one last
    expect(crowd.get("s_friend_2")!.score).toBeCloseTo(0, 6); // one last
    db.close();
  });

  it("counts every list exactly once", () => {
    const db = campus(4);
    expect(crowdScores(db).get("s_crowd")!.sample).toBe(4);
    expect(crowdScores(db).get("s_friend")!.sample).toBe(5); // four strangers + the friend
    db.close();
  });

  it("gives a one-place list a percentile of 1.0 rather than dividing by zero", () => {
    const db = campus(0);
    db.prepare(
      "INSERT INTO users (id, username, display_name, school_id, created_at) VALUES ('u_solo','solo','solo','osu','2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO ranking_entries (user_id, shop_id, position, inserted_at) VALUES ('u_solo','s_crowd',1,'2026-01-01T00:00:00Z')",
    ).run();
    expect(crowdScores(db).get("s_crowd")!.score).toBe(1);
    db.close();
  });
});

describe("what your own people think", () => {
  it("has no stranger in the arithmetic at all", () => {
    const db = campus(1);
    // s_friend: the friend has it #1 of two, the one stranger has it last.
    // The crowd averages the two; the friend score simply is not told about
    // the stranger, which is what makes it something a crowd cannot move.
    expect(crowdScores(db).get("s_friend")!.score).toBeCloseTo((1 + 0) / 2, 6);
    expect(friendScores(db, "u_me").get("s_friend")!.score).toBeCloseTo(1, 6);
    expect(friendScores(db, "u_me").get("s_friend")!.sample).toBe(1);
    db.close();
  });

  it("does not move when the crowd grows", () => {
    const one = campus(1);
    const many = campus(50);
    expect(friendScores(one, "u_me").get("s_friend")!.score).toBe(
      friendScores(many, "u_me").get("s_friend")!.score,
    );
    expect(crowdScores(one).get("s_friend")!.score).not.toBe(crowdScores(many).get("s_friend")!.score);
    one.close();
    many.close();
  });

  it("counts the viewer's own list as one of their own people's", () => {
    const db = campus(1);
    db.prepare(
      "INSERT INTO ranking_entries (user_id, shop_id, position, inserted_at) VALUES ('u_me','s_crowd',1,'2026-01-01T00:00:00Z')",
    ).run();
    expect(friendScores(db, "u_me").get("s_crowd")!.sample).toBe(1);
    expect(crowdScores(db).get("s_crowd")!.sample).toBe(2);
    db.close();
  });

  it("is empty for a logged-out reader, so everything falls to the crowd", () => {
    const db = campus(5);
    expect(friendScores(db, null).size).toBe(0);
    db.close();
  });

  it("is empty for an account with no friends and no list of its own", () => {
    const db = campus(5);
    db.prepare(
      "INSERT INTO users (id, username, display_name, school_id, created_at) VALUES ('u_new','new','new','osu','2026-08-01T00:00:00Z')",
    ).run();
    expect(friendScores(db, "u_new").size).toBe(0);
    db.close();
  });

  it("is a total order — same scores resolve the same way every time", () => {
    const db = campus(3);
    expect(orderOf(crowdScores(db))).toEqual(orderOf(crowdScores(db)));
    db.close();
  });
});

describe("the reason line names only people the viewer could already read", () => {
  it("names accepted friends, with the position they gave it", () => {
    const db = campus(3);
    expect(
      friendSignals(db, "u_me").get("s_friend")!.friends.map((f) => [f.username, f.position]),
    ).toEqual([["pal", 1]]);
    db.close();
  });

  it("counts strangers rather than naming them", () => {
    const db = campus(3);
    const signal = friendSignals(db, "u_me").get("s_crowd")!;
    expect(signal.friends).toEqual([]);
    expect(signal.others).toBe(3);
    expect(signal.total).toBe(3);
    db.close();
  });

  it("names nobody to a logged-out reader, but keeps the total honest", () => {
    const db = campus(3);
    const signal = friendSignals(db, null).get("s_friend")!;
    expect(signal.friends).toEqual([]);
    expect(signal.you).toBeNull();
    expect(signal.others).toBe(4); // the friend plus three strangers
    expect(signal.total).toBe(4);
    db.close();
  });

  it("separates the viewer's own position from their friends'", () => {
    const db = campus(3);
    db.prepare(
      "INSERT INTO ranking_entries (user_id, shop_id, position, inserted_at) VALUES ('u_me','s_crowd',1,'2026-01-01T00:00:00Z')",
    ).run();
    const signal = friendSignals(db, "u_me").get("s_crowd")!;
    expect(signal.you).toBe(1);
    expect(signal.friends).toEqual([]);
    expect(signal.others).toBe(3);
    db.close();
  });

  it("ignores a pending friend request — accepted only", () => {
    const db = campus(1);
    db.prepare(
      "INSERT INTO users (id, username, display_name, school_id, created_at) VALUES ('u_maybe','maybe','maybe','osu','2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO friendships (id, user_id, friend_id, status, created_at) VALUES ('f2','u_me','u_maybe','pending','2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO ranking_entries (user_id, shop_id, position, inserted_at) VALUES ('u_maybe','s_crowd',1,'2026-01-01T00:00:00Z')",
    ).run();
    const signal = friendSignals(db, "u_me").get("s_crowd")!;
    expect(signal.friends).toEqual([]);
    expect(signal.others).toBe(2); // the stranger and the pending request
    db.close();
  });
});

describe("against the database the app actually ships with", () => {
  const dbPath = join(dir, "seeded.db");
  runSeed(dbPath, DEFAULT_SEED_DIR);
  const db = openDb(dbPath);
  afterAll(() => db.close());

  // Maya has five accepted friends and a 22-place list of her own.
  const VIEWER = "u_maya";

  it("scores every place somebody has ranked, and nothing else", () => {
    const ranked = new Set(
      (db.prepare("SELECT DISTINCT shop_id FROM ranking_entries").all() as unknown as Array<{ shop_id: string }>).map(
        (r) => r.shop_id,
      ),
    );
    expect(new Set(crowdScores(db).keys())).toEqual(ranked);
    // Her people have not been everywhere, so hers is a strict subset.
    const mine = new Set(friendScores(db, VIEWER).keys());
    expect(mine.size).toBeGreaterThan(0);
    for (const id of mine) expect(ranked.has(id)).toBe(true);
  });

  it("gives a real viewer different scores from the crowd's", () => {
    expect(orderOf(friendScores(db, VIEWER))).not.toEqual(orderOf(crowdScores(db)));
  });

  it("never names a stranger, however public their ranking", () => {
    // june, theo and lena publish their rankings (seed/rankings.json), so the
    // share page may name them. This surface may not: "friends first" here
    // means friends only, and lena is only a *pending* friend of maya's.
    const friends = new Set(
      (
        db
          .prepare(
            `SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS fid
             FROM friendships WHERE status='accepted' AND (user_id = ? OR friend_id = ?)`,
          )
          .all(VIEWER, VIEWER, VIEWER) as unknown as Array<{ fid: string }>
      ).map((r) => r.fid),
    );
    const idOf = new Map(
      (
        db.prepare("SELECT id, username FROM users").all() as unknown as Array<{ id: string; username: string }>
      ).map((u) => [u.username, u.id]),
    );
    const named = new Set([...friendSignals(db, VIEWER).values()].flatMap((s) => s.friends.map((f) => f.username)));
    expect(named.size).toBeGreaterThan(0);
    for (const username of named) {
      expect(friends.has(idOf.get(username)!), `${username} is not an accepted friend of ${VIEWER}`).toBe(true);
    }
    expect(named.has("lena")).toBe(false);
  });

  it("keeps the cosign total honest even where it names nobody", () => {
    for (const signal of friendSignals(db, VIEWER).values()) {
      expect(signal.total).toBe(signal.friends.length + signal.others + (signal.you === null ? 0 : 1));
    }
  });
});
