// @vitest-environment node
//
// Brief #11: notifications only ever from human actions, never engagement
// bait. That is two separate claims and this file tests both at the level
// where they can actually be enforced:
//
//   * every row in the table points at a persisted record of somebody doing
//     something, and the feed is rendered from THAT record rather than from
//     a copy — so nothing can be said that is no longer true, and nothing
//     can be said about something nobody did;
//   * there are exactly five ways in, the database refuses a sixth, and no
//     path anywhere writes one without a person on the other end.
//
// The static half of the audit — that no timer, schedule or digest exists in
// the source at all — is src/design/no-bait.test.ts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "../../src/types/cosign";

const dir = mkdtempSync(join(tmpdir(), "cosign-notif-"));
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
const { feedFor, markRead, notify } = await import("./notifications");
const social = await import("./social");
const { app } = await import("../index");
const { makeSessionCookie } = await import("../auth/cookie");

runSeed(dbPath, DEFAULT_SEED_DIR);
const db = getDb();

const cookie = (userId: string) => makeSessionCookie(userId).split(";")[0];
const post = (path: string, body: unknown, as?: string) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...(as ? { Cookie: cookie(as) } : {}) },
    }),
  );

interface Row {
  id: string;
  user_id: string;
  actor_id: string;
  type: string;
  ref_kind: string;
  ref_id: string;
}
const allRows = () => db.prepare("SELECT * FROM notifications").all() as unknown as Row[];

/** Does this row's (ref_kind, ref_id) actually name a record that exists? */
function recordExists(r: Row): boolean {
  switch (r.ref_kind) {
    case "friendship":
      return !!db.prepare("SELECT 1 x FROM friendships WHERE id = ?").get(r.ref_id);
    case "list_editor":
      return !!db
        .prepare("SELECT 1 x FROM list_editors WHERE list_id = ? AND user_id = ?")
        .get(r.ref_id, r.user_id);
    case "list_rerank":
      return !!db.prepare("SELECT 1 x FROM list_reranks WHERE id = ?").get(r.ref_id);
    case "group_session":
      return !!db.prepare("SELECT 1 x FROM group_sessions WHERE id = ?").get(r.ref_id);
    default:
      return false;
  }
}

describe("every notification in the seeded database was caused by something", () => {
  it("there is no notifications.json — every row is derived from an action record", () => {
    const rows = allRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(recordExists(r), `${r.type} → ${r.ref_kind}:${r.ref_id}`).toBe(true);
    }
  });

  it("nobody is told about their own doing", () => {
    expect(allRows().filter((r) => r.user_id === r.actor_id)).toEqual([]);
  });

  it("the same act never lands twice", () => {
    const keys = allRows().map((r) => `${r.user_id}|${r.type}|${r.ref_kind}|${r.ref_id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses only the five types the brief allows", () => {
    const kinds = new Set(allRows().map((r) => r.type));
    for (const k of kinds) expect(NOTIFICATION_TYPES).toContain(k as (typeof NOTIFICATION_TYPES)[number]);
    expect(NOTIFICATION_TYPES).toHaveLength(5);
  });

  it("and the database refuses a sixth, including the one that was cut", () => {
    // `friend_logged` was in this CHECK until Phase 5B. It is the only one
    // that fires without anybody choosing to tell you anything.
    expect(() =>
      db
        .prepare(
          "INSERT INTO notifications (id, user_id, actor_id, type, ref_kind, ref_id, created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run("n_bad", "u_maya", "u_dev", "friend_logged", "log", "lg_1", "2026-08-16T00:00:00Z"),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO notifications (id, user_id, actor_id, type, ref_kind, ref_id, created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run("n_bad2", "u_maya", "u_dev", "anything_at_all", "whatever", "s1", "2026-08-16T00:00:00Z"),
    ).toThrow();
    // and the ref_kind is closed too: a row cannot point at a record type
    // this schema has never heard of
    expect(() =>
      db
        .prepare(
          "INSERT INTO notifications (id, user_id, actor_id, type, ref_kind, ref_id, created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run("n_bad3", "u_maya", "u_dev", "friend_request", "invented", "x", "2026-08-16T00:00:00Z"),
    ).toThrow();
  });

  it("refuses to notify somebody about themselves even when asked to", () => {
    expect(notify(db, {
      userId: "u_maya",
      actorId: "u_maya",
      type: "friend_request",
      refKind: "friendship",
      refId: "f_0",
    })).toBe(false);
  });
});

describe("the feed is rendered from the record, never from a copy", () => {
  it("the seeded pending request is the one thing asking Maya for an answer", () => {
    const feed = feedFor(db, "u_maya");
    const asking = feed.filter((e) => e.needs_answer);
    expect(asking).toHaveLength(1);
    expect(asking[0].type).toBe("friend_request");
    expect(asking[0].actor.username).toBe("lena");
    expect(asking[0].subject).toMatchObject({ status: "pending" });
  });

  it("answering it elsewhere settles the line, without touching the notification", async () => {
    const feed = feedFor(db, "u_maya");
    const asking = feed.find((e) => e.needs_answer)!;
    const before = db.prepare("SELECT * FROM notifications WHERE id = ?").get(asking.id);

    const friendship = social.friendshipBetween(db, "u_lena", "u_maya")!;
    const res = await post(`/api/friends/${friendship.id}/accept`, {}, "u_maya");
    expect(res.status).toBe(200);

    const after = feedFor(db, "u_maya").find((e) => e.id === asking.id)!;
    expect(after.needs_answer).toBe(false);
    expect(after.subject).toMatchObject({ status: "accepted" });
    // the row itself is untouched: the sentence changed because the world did
    expect(db.prepare("SELECT * FROM notifications WHERE id = ?").get(asking.id)).toEqual(before);
  });

  it("answering also tells the person who asked, and only them", () => {
    const fromMaya = feedFor(db, "u_lena").filter(
      (e) => e.type === "friend_accepted" && e.actor.id === "u_maya",
    );
    expect(fromMaya).toHaveLength(1);
    expect(fromMaya[0].needs_answer).toBe(false);
    // and the accepter is told nothing about accepting — it is their own act
    expect(feedFor(db, "u_maya").filter((e) => e.type === "friend_accepted" && e.actor.id === "u_maya")).toEqual([]);
  });

  it("a notification whose record is gone goes with it", () => {
    const before = feedFor(db, "u_lena").length;
    const friendship = social.friendshipBetween(db, "u_lena", "u_maya")!;
    db.prepare("DELETE FROM friendships WHERE id = ?").run(friendship.id);
    const after = feedFor(db, "u_lena");
    expect(after.length).toBeLessThan(before);
    expect(after.some((e) => e.ref.id === friendship.id)).toBe(false);
    // the row is still there — nothing deletes on a schedule — it just has
    // nothing left to say
    expect(
      (db.prepare("SELECT count(*) n FROM notifications WHERE ref_id = ?").get(friendship.id) as { n: number }).n,
    ).toBeGreaterThan(0);
  });

  it("a group invite stops asking once that person has said what they need", async () => {
    const start = await post("/api/group", { invite: ["dev"] }, "u_maya");
    const id = ((await start.json()) as { session: { id: string } }).session.id;
    const invite = () => feedFor(db, "u_dev").find((e) => e.type === "group_invite" && e.ref.id === id)!;
    expect(invite().needs_answer).toBe(true);
    expect(invite().subject).toMatchObject({ answered: 0 });
    await post(`/api/group/${id}/needs`, { participant_token: "pt-dev-invite-1" }, "u_dev");
    expect(invite().needs_answer).toBe(false);
    expect(invite().subject).toMatchObject({ answered: 1 });
  });
});

describe("a feed is one person's, and reading it is the only thing you do to it", () => {
  it("needs an account and returns only your own", async () => {
    expect(
      (await app.fetch(new Request("http://localhost/api/notifications"))).status,
    ).toBe(401);
    const res = await app.fetch(
      new Request("http://localhost/api/notifications", { headers: { Cookie: cookie("u_theo") } }),
    );
    const { entries } = (await res.json()) as { entries: Array<{ id: string }> };
    const mine = new Set(
      (db.prepare("SELECT id FROM notifications WHERE user_id = 'u_theo'").all() as unknown as Array<{ id: string }>)
        .map((r) => r.id),
    );
    for (const e of entries) expect(mine.has(e.id)).toBe(true);
  });

  it("marking read touches nobody else's", () => {
    const someoneElse = db
      .prepare("SELECT id FROM notifications WHERE user_id = 'u_june' LIMIT 1")
      .get() as { id: string };
    expect(markRead(db, "u_theo", [someoneElse.id])).toBe(0);
    const mine = feedFor(db, "u_theo")[0];
    expect(markRead(db, "u_theo", [mine.id])).toBe(1);
    expect(markRead(db, "u_theo", [mine.id])).toBe(0); // already read, not an event
    expect(feedFor(db, "u_theo").find((e) => e.id === mine.id)!.read_at).toBeTruthy();
  });

  it("there is no route that deletes one, and none that creates one directly", async () => {
    expect((await post("/api/notifications", { type: "friend_request" }, "u_maya")).status).toBe(404);
    const del = await app.fetch(
      new Request("http://localhost/api/notifications", {
        method: "DELETE",
        headers: { Cookie: cookie("u_maya") },
      }),
    );
    expect(del.status).toBe(404);
  });
});
