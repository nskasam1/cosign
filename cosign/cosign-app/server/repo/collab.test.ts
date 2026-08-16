// @vitest-environment node
//
// Collaborative lists on the seeded campus, driven through the routes.
// src/lib/collab.test.ts owns the arithmetic; this owns everything around
// it — who may re-rank, what the re-rank writes, who is told, and the fact
// that a list only ever moves because a person moved it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "cosign-collab-"));
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
const lists = await import("./lists");
const { feedFor } = await import("./notifications");
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

const MAYAS = "l_our-campus-ranking"; // maya + dev + june, six places
const DEVS = "l_still-open-when-we-are"; // dev + theo, six places, one nobody has ranked
const order = (listId: string) => lists.itemsOf(db, listId).map((it) => it.shop_id);
const reranksFor = (userId: string) => feedFor(db, userId).filter((e) => e.type === "list_reranked");

describe("a list with two or more contributors re-ranks from their own lists", () => {
  it("starts in the order it was built in", () => {
    expect(order(MAYAS)).toEqual([
      "s_lantern-lane",
      "s_foundry",
      "s_terrazzo",
      "s_hackberry",
      "s_marginalia",
      "s_cricket-and-crow",
    ]);
    const list = lists.listById(db, MAYAS)!;
    expect(lists.contributorsOf(db, list).map((c) => c.user_id)).toEqual(["u_maya", "u_dev", "u_june"]);
    expect(lists.isSettled(db, list)).toBe(false);
  });

  it("an editor re-ranks it, and the order comes from the head-to-head", async () => {
    const res = await post(`/api/lists/${MAYAS}/rerank`, {}, "u_dev");
    expect(res.status, await res.text()).toBe(201);
    // Lantern Lane wins four pairs and loses none; The Foundry is Dev's #1
    // and Maya's 13th, so it goes last — the cost of collaborating, printed.
    expect(order(MAYAS)).toEqual([
      "s_lantern-lane",
      "s_cricket-and-crow",
      "s_marginalia",
      "s_hackberry",
      "s_terrazzo",
      "s_foundry",
    ]);
    expect(lists.isSettled(db, lists.listById(db, MAYAS)!)).toBe(true);
  });

  it("tells the other contributors, and not the one who did it", () => {
    expect(reranksFor("u_maya")).toHaveLength(1);
    expect(reranksFor("u_june")).toHaveLength(1);
    expect(reranksFor("u_dev")).toHaveLength(0);
    const entry = reranksFor("u_maya")[0];
    expect(entry.actor.id).toBe("u_dev");
    expect(entry.ref.kind).toBe("list_rerank");
    expect(entry.subject).toMatchObject({ list_id: MAYAS, title: "our ranking of campus coffee" });
    expect(entry.subject.moved).toBeGreaterThan(0);
    expect(entry.needs_answer).toBe(false);
  });

  it("a second re-rank that would move nothing is not an event", async () => {
    const before = reranksFor("u_maya").length;
    const res = await post(`/api/lists/${MAYAS}/rerank`, {}, "u_june");
    expect(res.status).toBe(409);
    expect(reranksFor("u_maya")).toHaveLength(before);
    expect(db.prepare("SELECT count(*) n FROM list_reranks WHERE list_id = ?").get(MAYAS)).toEqual({ n: 1 });
  });

  it("keeps a place nobody who can edit has ranked, at the end and without a standing", async () => {
    expect((await post(`/api/lists/${DEVS}/rerank`, {}, "u_theo")).status).toBe(201);
    const after = order(DEVS);
    // Copper Kettle is on neither Dev's nor Theo's list, so it cannot be
    // compared with anything — it keeps its place in the list rather than
    // being given one it has not earned, or quietly dropped.
    expect(after.at(-1)).toBe("s_copper-kettle");
    const derived = lists.derivedOrder(db, lists.listById(db, DEVS)!);
    expect(derived.unranked.map((r) => r.shop_id)).toEqual(["s_copper-kettle"]);
    expect(derived.unranked[0].positions).toEqual([]);
    // Theo has Night Owl first and Dev has it ninth of ten; the pair still
    // goes to Theo because Dev is the only other voice and they split — and
    // when they split, the list's own order decides
    expect(derived.disagreements.length).toBeGreaterThan(0);
  });
});

describe("only the people who can write to it may move it", () => {
  it("a stranger cannot re-rank, and cannot tell the list exists", async () => {
    expect((await post(`/api/lists/${MAYAS}/rerank`, {}, "u_sam")).status).toBe(404);
    expect((await post(`/api/lists/${MAYAS}/rerank`, {})).status).toBe(401);
  });

  it("a list with one contributor has nothing to merge", async () => {
    const solo = lists.createList(db, { owner_id: "u_lena", title: "mine alone", is_collaborative: false });
    lists.addItem(db, solo.id, "s_oval-grounds", "u_lena");
    lists.addItem(db, solo.id, "s_percolate", "u_lena");
    const derived = lists.derivedOrder(db, lists.listById(db, solo.id)!);
    expect(derived.source).toBe("owner");
    expect(derived.contributors).toBe(1);
    expect((await post(`/api/lists/${solo.id}/rerank`, {}, "u_lena")).status).toBe(409);
  });
});

describe("handing somebody the pen is a human action with a record", () => {
  it("only the owner may, and only to somebody they have agreed to know", async () => {
    // u_june is an editor, not the owner
    expect((await post(`/api/lists/${MAYAS}/editors`, { username: "sam" }, "u_june")).status).toBe(404);
    // u_lena and u_maya are still a PENDING request in the seed
    expect((await post(`/api/lists/${MAYAS}/editors`, { username: "lena" }, "u_maya")).status).toBe(403);
    expect((await post(`/api/lists/${MAYAS}/editors`, { username: "nobody" }, "u_maya")).status).toBe(404);
  });

  it("adds them, tells them, and refuses to do it twice", async () => {
    const before = feedFor(db, "u_sam").length;
    expect((await post(`/api/lists/${MAYAS}/editors`, { username: "sam" }, "u_maya")).status).toBe(201);
    expect((await post(`/api/lists/${MAYAS}/editors`, { username: "sam" }, "u_maya")).status).toBe(409);
    const feed = feedFor(db, "u_sam");
    expect(feed).toHaveLength(before + 1);
    expect(feed[0]).toMatchObject({ type: "list_editor_added", needs_answer: false });
    expect(feed[0].actor.id).toBe("u_maya");
    expect(feed[0].subject).toMatchObject({ list_id: MAYAS });
  });

  it("and a new contributor's list can move it again", async () => {
    // u_sam ranks Hackberry first and Terrazzo fifth, which the old order
    // did not know about
    expect(lists.isSettled(db, lists.listById(db, MAYAS)!)).toBe(false);
    expect((await post(`/api/lists/${MAYAS}/rerank`, {}, "u_sam")).status).toBe(201);
    expect(reranksFor("u_maya")).toHaveLength(2);
    expect(reranksFor("u_sam")).toHaveLength(0);
  });
});
