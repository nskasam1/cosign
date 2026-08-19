// @vitest-environment node
//
// The north star, on the seeded events rather than on a fixture built to
// make it true (PLAN decision 11): the count of users who, within a given
// ISO week, have app_open events on >= 2 distinct days AND created zero logs
// that week — the people who came back without logging.
//
// analytics.test.ts already exercises the SQL on four hand-made accounts.
// What this file adds is the only thing that fixture cannot: that the query
// says something true about the data the product actually ships with, and
// that it says it because of the predicate rather than by coincidence — the
// cohort is recomputed here from the raw events table by a second, dumber
// implementation and the two have to agree.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "cosign-northstar-"));
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
const { northStarWeekly } = await import("./analytics");

runSeed(dbPath, DEFAULT_SEED_DIR);
const db = getDb();

// The seeder builds a deliberately quiet week here: every user who did not
// log in it gets two app_opens on two distinct days.
const QUIET_WEEK = new Date("2026-08-03T00:00:00-04:00");

interface EventRow {
  user_id: string | null;
  event: string;
  created_at: string;
}

/** The predicate again, in plain JS, from the raw rows. */
function cohortByHand(weekStart: Date): string[] {
  const start = weekStart.getTime();
  const end = start + 7 * 86400_000;
  const rows = db.prepare("SELECT user_id, event, created_at FROM analytics_events").all() as unknown as EventRow[];
  const opens = new Map<string, Set<string>>();
  const logged = new Set<string>();
  for (const r of rows) {
    if (!r.user_id) continue; // an anonymous event belongs to nobody
    const t = new Date(r.created_at).getTime();
    if (t < start || t >= end) continue;
    if (r.event === "log_created") logged.add(r.user_id);
    if (r.event === "app_open") {
      // the same calendar day in UTC, which is what the SQL's date() does
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      if (!opens.has(r.user_id)) opens.set(r.user_id, new Set());
      opens.get(r.user_id)!.add(day);
    }
  }
  return [...opens.entries()]
    .filter(([uid, days]) => days.size >= 2 && !logged.has(uid))
    .map(([uid]) => uid)
    .sort();
}

describe("the north star on the seeded events", () => {
  it("counts the people who came back and logged nothing", () => {
    const res = northStarWeekly(db, QUIET_WEEK);
    expect(res.count).toBeGreaterThan(0);
    expect(res.users).toEqual([...res.users].sort());
    expect(res.users).toEqual(cohortByHand(QUIET_WEEK));
  });

  it("every one of them really did open it on two different days and write nothing", () => {
    const { users, week_start, week_end } = northStarWeekly(db, QUIET_WEEK);
    for (const uid of users) {
      const days = db
        .prepare(
          `SELECT count(DISTINCT date(datetime(created_at))) AS n FROM analytics_events
           WHERE user_id = ? AND event = 'app_open'
             AND datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)`,
        )
        .get(uid, week_start, week_end) as { n: number };
      expect(days.n).toBeGreaterThanOrEqual(2);
      const logs = db
        .prepare(
          `SELECT count(*) AS n FROM analytics_events
           WHERE user_id = ? AND event = 'log_created'
             AND datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)`,
        )
        .get(uid, week_start, week_end) as { n: number };
      expect(logs.n).toBe(0);
    }
  });

  it("excludes the people who did log that week, however often they opened it", () => {
    const { users, week_start, week_end } = northStarWeekly(db, QUIET_WEEK);
    const loggers = db
      .prepare(
        `SELECT DISTINCT user_id FROM analytics_events
         WHERE event = 'log_created' AND user_id IS NOT NULL
           AND datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)`,
      )
      .all(week_start, week_end) as unknown as Array<{ user_id: string }>;
    expect(loggers.length).toBeGreaterThan(0);
    for (const l of loggers) expect(users).not.toContain(l.user_id);
  });

  it("it is a WEEKLY number: a different week is a different answer", () => {
    const quiet = northStarWeekly(db, QUIET_WEEK).count;
    const before = northStarWeekly(db, new Date("2026-07-27T00:00:00-04:00")).count;
    const after = northStarWeekly(db, new Date("2026-08-10T00:00:00-04:00")).count;
    expect([before, after]).not.toContain(quiet);
    expect(after).toBe(0); // nothing was seeded past the quiet week
  });

  it("anonymous events are nobody's return", () => {
    const anon = db
      .prepare("SELECT count(*) AS n FROM analytics_events WHERE user_id IS NULL")
      .get() as { n: number };
    expect(anon.n).toBeGreaterThan(0); // share_viewed from logged-out readers
    expect(northStarWeekly(db, QUIET_WEEK).users).not.toContain(null);
  });

  it("and the whole thing is local: the events table names no coordinate", () => {
    const props = db
      .prepare("SELECT props_json FROM analytics_events")
      .all() as unknown as Array<{ props_json: string }>;
    for (const p of props) {
      expect(p.props_json).not.toMatch(/\b(lat|lng|latitude|longitude|coords?)\b/i);
    }
  });
});
