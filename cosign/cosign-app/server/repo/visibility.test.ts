// @vitest-environment node
//
// Friends-only is the default and a share token is the only public override
// (decision 9/12). These are the query-level checks that replaced Supabase
// RLS, so a regression here silently exposes people's lists.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../db/db";
import { cosignersOf, canViewRanking } from "./rank";
import { visibleLogsForShop } from "./logsRepo";
import { friendIdsOf } from "./social";
import { loadShareData } from "../pages/shareList";
import type { ShareToken } from "../../src/types/cosign";

const dir = mkdtempSync(join(tmpdir(), "cosign-vis-"));
const db = createDb(join(dir, "test.db"));

db.exec(`INSERT INTO schools (id, name) VALUES ('osu', 'Ohio State University');`);
for (const u of ["u_me", "u_pal", "u_stranger", "u_open"]) {
  db.prepare(
    "INSERT INTO users (id, username, display_name, school_id, created_at) VALUES (?,?,?,?,?)",
  ).run(u, u.slice(2), u, "osu", "2026-01-01T00:00:00Z");
}
db.prepare(
  "INSERT INTO shops (id, slug, name, address, lat, lng, school_id, student_discount, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
).run("s_a", "a", "Shop A", "1 High St", 40, -83, "osu", 0, "2026-01-01T00:00:00Z");

db.prepare(
  "INSERT INTO friendships (id, user_id, friend_id, status, created_at) VALUES (?,?,?,?,?)",
).run("f1", "u_me", "u_pal", "accepted", "2026-01-01T00:00:00Z");

// everyone ranks the same shop; only u_open's ranking is public
for (const [u, vis] of [
  ["u_me", "friends"],
  ["u_pal", "friends"],
  ["u_stranger", "friends"],
  ["u_open", "public"],
] as const) {
  db.prepare("INSERT INTO rankings (user_id, visibility, updated_at) VALUES (?,?,?)").run(
    u, vis, "2026-01-01T00:00:00Z",
  );
  db.prepare(
    "INSERT INTO ranking_entries (user_id, shop_id, position, inserted_at) VALUES (?,?,?,?)",
  ).run(u, "s_a", 1, "2026-01-01T00:00:00Z");
}

const insLog = db.prepare(
  `INSERT INTO logs (id, user_id, shop_id, intent_tag, time_bucket, semester, taps_json, visibility, created_at)
   VALUES (?,?,?,'deep_work','morning','2026-autumn','{}',?,?)`,
);
insLog.run("lg_me", "u_me", "s_a", "friends", "2026-08-01T10:00:00Z");
insLog.run("lg_pal", "u_pal", "s_a", "friends", "2026-08-02T10:00:00Z");
insLog.run("lg_stranger", "u_stranger", "s_a", "friends", "2026-08-03T10:00:00Z");
insLog.run("lg_public", "u_open", "s_a", "public", "2026-08-04T10:00:00Z");

const names = (viewer: string | null) =>
  cosignersOf(db, "s_a", viewer).cosigners.map((c) => c.user_id).sort();

describe("cosigners never name a ranking the viewer may not see", () => {
  it("a logged-out viewer sees only public rankings, but an honest total", () => {
    const res = cosignersOf(db, "s_a", null);
    expect(res.cosigners.map((c) => c.user_id)).toEqual(["u_open"]);
    expect(res.others).toBe(3);
    expect(res.total).toBe(4);
  });

  it("a signed-in viewer sees self + accepted friends + public", () => {
    expect(names("u_me")).toEqual(["u_me", "u_open", "u_pal"]);
    expect(cosignersOf(db, "s_a", "u_me").others).toBe(1); // u_stranger stays hidden
  });

  it("a stranger is not promoted by merely signing in", () => {
    expect(names("u_stranger")).toEqual(["u_open", "u_stranger"]);
  });

  it("friends sort ahead of non-friends", () => {
    const res = cosignersOf(db, "s_a", "u_me");
    expect(res.cosigners[0].is_friend).toBe(true);
    expect(res.cosigners.at(-1)!.user_id).toBe("u_open");
  });
});

describe("ranking visibility", () => {
  it("friends-only by default; public opts in", () => {
    expect(canViewRanking(db, null, "u_me")).toBe(false);
    expect(canViewRanking(db, "u_stranger", "u_me")).toBe(false);
    expect(canViewRanking(db, "u_pal", "u_me")).toBe(true);
    expect(canViewRanking(db, "u_me", "u_me")).toBe(true);
    expect(canViewRanking(db, null, "u_open")).toBe(true);
  });

  it("a user with no rankings row is treated as friends-only, not public", () => {
    db.prepare(
      "INSERT INTO users (id, username, display_name, school_id, created_at) VALUES (?,?,?,?,?)",
    ).run("u_norow", "norow", "norow", "osu", "2026-01-01T00:00:00Z");
    expect(canViewRanking(db, null, "u_norow")).toBe(false);
  });
});

describe("shop logs respect visibility", () => {
  it("logged out sees only public logs", () => {
    expect(visibleLogsForShop(db, "s_a", null, []).map((l) => l.id)).toEqual(["lg_public"]);
  });

  it("a viewer sees own + friends' + public, never a stranger's", () => {
    const ids = visibleLogsForShop(db, "s_a", "u_me", friendIdsOf(db, "u_me")).map((l) => l.id).sort();
    expect(ids).toEqual(["lg_me", "lg_pal", "lg_public"]);
  });

  it("the visibility predicate is not defeated by the row limit", () => {
    // 40 stranger logs newer than the friend's log would crowd it out of any
    // fixed prefetch that filters afterwards
    for (let i = 0; i < 40; i++) {
      insLog.run(`lg_noise${i}`, "u_stranger", "s_a", "friends", `2026-09-${String(i % 28 + 1).padStart(2, "0")}T10:00:00Z`);
    }
    const ids = visibleLogsForShop(db, "s_a", "u_me", friendIdsOf(db, "u_me"), 30).map((l) => l.id);
    expect(ids).toContain("lg_pal");
    expect(ids.some((id) => id.startsWith("lg_noise"))).toBe(false);
  });
});

describe("share tokens are scoped to exactly one surface", () => {
  const token = (kind: ShareToken["kind"], list_id: string | null = null): ShareToken =>
    ({ token: "t", kind, user_id: "u_me", list_id, created_at: "2026-01-01T00:00:00Z", revoked_at: null }) as ShareToken;

  it("a ranking token renders the ranking", () => {
    expect(loadShareData(db, token("ranking"))).not.toBeNull();
  });

  it("a profile token does not fall through to the whole ranking", () => {
    expect(loadShareData(db, token("profile"))).toBeNull();
  });

  it("a list token with no list resolves to nothing", () => {
    expect(loadShareData(db, token("list"))).toBeNull();
  });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
