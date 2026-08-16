// @vitest-environment node
//
// Group decision mode, driven through the routes it ships behind, against
// the real seeded campus — because "intersection-best for 4 seeded users" is
// a claim about this data and this API, not about a fixture.
//
// The reasoning itself is unit-tested in src/lib/group.test.ts. What is
// tested here is everything the pure function cannot see: that answering
// needs no account, that a signed-in answer brings that person's own ordered
// list and nobody else's, that the table stops at four, and that a
// link-holder cannot read more of anybody's ranking than the page prints.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AcademicCalendar } from "../../src/lib/calendar";
import { MAX_PARTICIPANTS } from "../../src/lib/group";

const dir = mkdtempSync(join(tmpdir(), "cosign-group-"));
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
const { sessionView, createSession, submitNeeds } = await import("./group");
const { app } = await import("../index");
const { makeSessionCookie } = await import("../auth/cookie");

runSeed(dbPath, DEFAULT_SEED_DIR);
const db = getDb();
const CALENDAR: AcademicCalendar = JSON.parse(
  readFileSync(join(DEFAULT_SEED_DIR, "academic-calendar.json"), "utf-8"),
);

// A Wednesday at half past seven: enough places open to make the constraints
// do work, and the evening bucket is the one the seeded logs cover best.
const NOW = new Date("2026-08-19T19:30:00-04:00");

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

// The four are an accepted-friend clique in seed/friendships.json, which is
// what lets any of them start a session with the other three.
const FOUR = ["u_maya", "u_dev", "u_june", "u_theo"] as const;

/** What each of them taps. Real needs, not a set chosen to force an answer. */
const NEEDS = {
  u_maya: { intent_tag: "group_project", outlets: true, open_now: true, wifi: true, max_noise: null },
  u_june: { intent_tag: "reading", outlets: false, open_now: true, wifi: false, max_noise: "conversational" },
  u_theo: { intent_tag: "late_night", outlets: true, open_now: true, wifi: false, max_noise: null },
  u_dev: { intent_tag: "deep_work", outlets: true, open_now: true, wifi: true, max_noise: "conversational" },
} as const;

let sessionId = "";

beforeAll(async () => {
  const res = await post("/api/group", { invite: ["dev", "june", "theo"] }, "u_maya");
  expect(res.status).toBe(201);
  sessionId = ((await res.json()) as { session: { id: string } }).session.id;
  for (const uid of FOUR) {
    const r = await post(
      `/api/group/${sessionId}/needs`,
      { participant_token: `pt-${uid}-0001`, ...NEEDS[uid] },
      uid,
    );
    expect(r.status, await r.text()).toBe(201);
  }
});

// Maya is a signed-in member, so this reader is seated and the positions are
// on the payload. Everything about the unseated view is tested separately.
const view = (opts: Parameters<typeof sessionView>[3] = {}) =>
  sessionView(db, CALENDAR, sessionId, { now: NOW, viewerId: "u_maya", ...opts })!;

describe("four seeded users, one table", () => {
  it("unions their needs into the constraints every place has to meet", () => {
    const v = view();
    expect(v.state).toBe("complete");
    expect(v.answers).toHaveLength(4);
    const byKey = Object.fromEntries(v.constraints.map((c) => [c.key, c]));
    expect(Object.keys(byKey).sort()).toEqual(["noise", "open_now", "outlets", "table", "wifi"]);
    // three of the four need to plug in, so one socket is not enough
    expect(byKey.outlets.detail).toBe("3 outlets");
    expect(byKey.outlets.askedBy).toHaveLength(3);
    // the strictest ceiling anybody set is the group's
    expect(byKey.noise.detail).toBe("no louder than conversational");
    // and nobody had to ask for somewhere to sit
    expect(byKey.table).toMatchObject({ detail: "a table for 4", askedBy: [] });
  });

  it("answers with the one place nobody in the room objects to", () => {
    const v = view();
    const best = v.picks[0];
    expect(v.places[best.shop_id].name).toBe("Lantern Lane Cafe");
    // Maya has it first of twenty-two and June fourth of ten; Dev and Theo
    // have never been, which is neutral and is said out loud rather than
    // counted as agreement.
    expect(best.coverage).toBe(2);
    // a position, and never the length of the list it came out of
    expect(best.worst).toEqual({ user_id: "u_june", position: 4 });
    expect(best.never_been.sort()).toEqual(["Dev", "Theo"]);
  });

  it("and beats the place all four have been to, because somebody has it last", () => {
    const v = view();
    const grandview = v.picks.find((p) => v.places[p.shop_id].name === "Grandview Social")!;
    expect(grandview.coverage).toBe(4);
    // Dev and June both have it bottom of ten; the one named is the lower id,
    // never whoever happened to answer first
    expect(grandview.worst).toEqual({ user_id: "u_dev", position: 10 });
    expect(v.picks.indexOf(grandview)).toBeGreaterThan(0);
  });

  it("does not depend on who answered first", () => {
    // Six orders of the same four answers; the table does not change because
    // of who got to their phone first.
    const orders = [
      ["u_maya", "u_dev", "u_june", "u_theo"],
      ["u_theo", "u_june", "u_dev", "u_maya"],
      ["u_june", "u_maya", "u_theo", "u_dev"],
      ["u_dev", "u_theo", "u_maya", "u_june"],
    ] as const;
    const answers = orders.map((order, n) => {
      const s = createSession(db, { createdBy: "u_maya", schoolId: "osu", invite: [] });
      for (const uid of order) {
        submitNeeds(db, s.id, {
          participantToken: `pt-order-${n}-${uid}`,
          userId: uid,
          displayName: null,
          intentTag: NEEDS[uid].intent_tag,
          outlets: NEEDS[uid].outlets,
          openNow: NEEDS[uid].open_now,
          wifi: NEEDS[uid].wifi,
          maxNoise: NEEDS[uid].max_noise,
        });
      }
      const v = sessionView(db, CALENDAR, s.id, { now: NOW, viewerId: "u_maya" })!;
      return v.picks.map((p) => `${v.places[p.shop_id].name}/${p.worst?.user_id ?? "-"}`);
    });
    for (const a of answers) expect(a).toEqual(answers[0]);
    expect(answers[0][0]).toBe("Lantern Lane Cafe/u_june");
  });

  it("but it does move while people are still answering, and says it is partial", () => {
    // The honest counterpart: a table of two is not the same question as a
    // table of four, so the page must never present the early answer as
    // settled. Maya alone, then Maya and Dev:
    const s = createSession(db, { createdBy: "u_maya", schoolId: "osu", invite: ["u_dev", "u_june", "u_theo"] });
    const answer = () => {
      const v = sessionView(db, CALENDAR, s.id, { now: NOW, viewerId: "u_maya" })!;
      return { state: v.state, best: v.picks[0] ? v.places[v.picks[0].shop_id].name : null };
    };
    const add = (uid: (typeof FOUR)[number]) =>
      submitNeeds(db, s.id, {
        participantToken: `pt-partial-${uid}`,
        userId: uid,
        displayName: null,
        intentTag: NEEDS[uid].intent_tag,
        outlets: NEEDS[uid].outlets,
        openNow: NEEDS[uid].open_now,
        wifi: NEEDS[uid].wifi,
        maxNoise: NEEDS[uid].max_noise,
      });
    add("u_maya");
    expect(answer().state).toBe("alone");
    add("u_dev");
    expect(answer()).toEqual({ state: "partial", best: "Wheelhouse Coffee" });
    add("u_june");
    add("u_theo");
    expect(answer()).toEqual({ state: "complete", best: "Lantern Lane Cafe" });
  });

  it("names what it could not vouch for instead of quietly passing it", () => {
    const v = view();
    // somewhere nobody has logged this hour cannot answer a noise question
    expect(v.unvouched.length).toBeGreaterThan(0);
    for (const id of v.unvouched) expect(v.picks.some((p) => p.shop_id === id)).toBe(false);
    expect(v.ruled_out_total + v.picks.length + v.more + v.unvouched.length + v.unknown_to_all.length)
      .toBeLessThanOrEqual(22);
  });
});

describe("answering needs no account", () => {
  it("a link-holder with no session at all can read it and say what they need", async () => {
    const read = await call(`/api/group/${sessionId}`);
    expect(read.status).toBe(200);

    const fresh = await post("/api/group", { invite: [] }, "u_maya");
    const id = ((await fresh.json()) as { session: { id: string } }).session.id;
    const answered = await post(`/api/group/${id}/needs`, {
      participant_token: "pt-anonymous-9999",
      display_name: "Whoever",
      intent_tag: "quick_grab",
      outlets: true,
    });
    expect(answered.status).toBe(201);
    const v = sessionView(db, CALENDAR, id, { now: NOW })!;
    expect(v.answers.map((a) => a.display_name)).toContain("Whoever");
    // …and brings no list to the arithmetic, which is the honest trade
    expect(v.answers.find((a) => a.display_name === "Whoever")!.brings_a_list).toBe(false);
  });

  it("but a signed-in person is named from their account, never from the body", async () => {
    const fresh = await post("/api/group", { invite: [] }, "u_maya");
    const id = ((await fresh.json()) as { session: { id: string } }).session.id;
    await post(`/api/group/${id}/needs`, { participant_token: "pt-liar-0001", display_name: "Not Dev" }, "u_dev");
    const v = sessionView(db, CALENDAR, id, { now: NOW })!;
    expect(v.answers[0].display_name).toBe("Dev");
    expect(v.answers[0].brings_a_list).toBe(true);
  });

  it("one person who answered anonymously and then signed in is still one seat", async () => {
    // The phone answers with no account; the laptop answers signed in; then
    // the phone signs in and answers again. That used to collide with the
    // partial unique index and leave the phone permanently unable to answer.
    const fresh = await post("/api/group", { invite: [] }, "u_maya");
    const id = ((await fresh.json()) as { session: { id: string } }).session.id;
    expect((await post(`/api/group/${id}/needs`, { participant_token: "pt-phone-anon1" })).status).toBe(201);
    expect(
      (await post(`/api/group/${id}/needs`, { participant_token: "pt-laptop-0001", outlets: true }, "u_dev"))
        .status,
    ).toBe(201);
    const again = await post(
      `/api/group/${id}/needs`,
      { participant_token: "pt-phone-anon1", wifi: true },
      "u_dev",
    );
    expect(again.status, await again.text()).toBe(201);
    const v = sessionView(db, CALENDAR, id, { now: NOW })!;
    expect(v.answers).toHaveLength(1);
    expect(v.answers[0]).toMatchObject({ wifi: true, outlets: false });
  });

  it("one person holds one seat however many tabs they open", async () => {
    const fresh = await post("/api/group", { invite: [] }, "u_maya");
    const id = ((await fresh.json()) as { session: { id: string } }).session.id;
    await post(`/api/group/${id}/needs`, { participant_token: "pt-tab-a", outlets: true }, "u_dev");
    await post(`/api/group/${id}/needs`, { participant_token: "pt-tab-b", outlets: false }, "u_dev");
    const v = sessionView(db, CALENDAR, id, { now: NOW })!;
    expect(v.answers).toHaveLength(1);
    expect(v.answers[0].outlets).toBe(false); // the newer answer replaced the older
  });

  it("the table is full at four", async () => {
    const fresh = await post("/api/group", { invite: [] }, "u_maya");
    const id = ((await fresh.json()) as { session: { id: string } }).session.id;
    for (let i = 0; i < MAX_PARTICIPANTS; i++) {
      expect((await post(`/api/group/${id}/needs`, { participant_token: `pt-crowd-${i}00` })).status).toBe(201);
    }
    const fifth = await post(`/api/group/${id}/needs`, { participant_token: "pt-crowd-fifth" });
    expect(fifth.status).toBe(409);
  });
});

describe("a session is not a way to reach people you do not know", () => {
  it("refuses to invite somebody who is not an accepted friend", async () => {
    // u_sam and u_dev are not friends in the seed
    const res = await post("/api/group", { invite: ["sam"] }, "u_dev");
    expect(res.status).toBe(403);
  });

  it("and starting one requires an account, even though answering does not", async () => {
    expect((await post("/api/group", { invite: [] })).status).toBe(401);
  });

  it("only whoever started it may close it", async () => {
    const fresh = await post("/api/group", { invite: ["dev"] }, "u_maya");
    const id = ((await fresh.json()) as { session: { id: string } }).session.id;
    expect((await post(`/api/group/${id}/resolve`, { shop_id: "s_foundry" }, "u_dev")).status).toBe(404);
    expect((await post(`/api/group/${id}/resolve`, { shop_id: "s_foundry" }, "u_maya")).status).toBe(200);
    // and a settled session takes no more answers
    expect(
      (await post(`/api/group/${id}/needs`, { participant_token: "pt-too-late-01" })).status,
    ).toBe(409);
  });
});

describe("sitting at a table is not a friendship", () => {
  it("a by-link seat gets the answer and nobody's position", () => {
    const seated = view();
    expect(seated.seated).toBe(true);
    expect(seated.picks[0].positions.length).toBeGreaterThan(0);

    // the same page, read by whoever holds the link
    const anon = sessionView(db, CALENDAR, sessionId, { now: NOW })!;
    expect(anon.seated).toBe(false);
    expect(anon.picks.map((p) => p.shop_id)).toEqual(seated.picks.map((p) => p.shop_id));
    for (const p of anon.picks) {
      expect(p.positions).toEqual([]);
      expect(p.worst).toBeNull();
      expect(p.never_been).toEqual([]);
      // the count survives, because it names nobody
      expect(p.coverage).toBeGreaterThanOrEqual(0);
    }
    // …and so does everything the page is actually for
    expect(anon.constraints.length).toBe(seated.constraints.length);
    expect(anon.funnel.left).toBe(seated.funnel.left);
  });

  it("a signed-in stranger to the table reads no positions either", () => {
    // u_sam is friends with Maya but not with Dev, June or Theo
    const outsider = sessionView(db, CALENDAR, sessionId, { now: NOW, viewerId: "u_sam" })!;
    expect(outsider.seated).toBe(false);
    expect(outsider.picks.every((p) => p.positions.length === 0)).toBe(true);
  });

  it("and cannot take a seat, because everybody at it has to know everybody", async () => {
    // u_sam is an accepted friend of Maya, who started it, and of nobody else
    const res = await post(`/api/group/${sessionId}/needs`, { participant_token: "pt-sam-000001" }, "u_sam");
    expect(res.status).toBe(403);
    // but the link still works for a seat with no account and no list
    const anon = await post(`/api/group/${sessionId}/needs`, { participant_token: "pt-anon-000001" });
    expect([201, 409]).toContain(anon.status); // 409 only if the table is full
  });

  it("the length of anybody's ranked list never leaves the server", () => {
    const v = view();
    const wire = JSON.stringify(v);
    expect(wire).not.toMatch(/"of"\s*:/);
    for (const p of v.picks) for (const pos of p.positions) expect(Object.keys(pos).sort()).toEqual(["position", "user_id"]);
  });

  it("a session id is a link, so it is unguessable and carries no clock", () => {
    expect(sessionId).toMatch(/^g_[A-Za-z0-9_-]{16,}$/);
    const a = createSession(db, { createdBy: "u_maya", schoolId: "osu", invite: [] });
    const b = createSession(db, { createdBy: "u_maya", schoolId: "osu", invite: [] });
    expect(a.id).not.toBe(b.id);
    // nothing in it counts up, so two made in the same second do not sort
    expect(a.id.slice(0, 6)).not.toBe(b.id.slice(0, 6));
  });
});

describe("a link-holder reads no more of anybody's list than the page prints", () => {
  it("caps the survivors it names, however wide the constraints are", async () => {
    // nobody taps anything: every open place qualifies, which without a cap
    // would hand whoever holds the link four people's whole rankings
    const fresh = await post("/api/group", { invite: [] }, "u_maya");
    const id = ((await fresh.json()) as { session: { id: string } }).session.id;
    for (const uid of FOUR) {
      submitNeeds(db, id, {
        participantToken: `pt-wide-${uid}`,
        userId: uid,
        displayName: null,
        intentTag: null,
        outlets: false,
        openNow: false,
        wifi: false,
        maxNoise: null,
      });
    }
    const v = sessionView(db, CALENDAR, id, { now: NOW, viewerId: "u_maya" })!;
    expect(v.picks.length).toBeLessThanOrEqual(6);
    expect(v.more).toBeGreaterThan(0);
    const named = new Set(v.picks.flatMap((p) => p.positions.map((x) => x.user_id)));
    // Maya has ranked all twenty-two places; at most six of them are readable
    expect(v.picks.flatMap((p) => p.positions).filter((x) => x.user_id === "u_maya").length)
      .toBeLessThanOrEqual(6);
    for (const uid of named) expect(FOUR).toContain(uid as (typeof FOUR)[number]);
  });

  it("names nobody who is not in the room", async () => {
    const v = view();
    const named = new Set(v.picks.flatMap((p) => p.positions.map((x) => x.user_id)));
    expect([...named].every((uid) => (FOUR as readonly string[]).includes(uid))).toBe(true);
    expect(Object.keys(v.members).sort()).toEqual([...FOUR].sort());
  });
});
