// @vitest-environment node
//
// Home's whole answer, tested through the function the route calls — so the
// hero query, the friend tier and the finals switch are exercised as they
// ship rather than as a rehearsal of them.
//
// Three things are arguments here on purpose: the position (a momentary
// GeoProvider read), the clock, and the calendar. That is what makes
// "correct via stubbed geolocation" and "mocked finals week" testable
// without putting a date or a coordinate backdoor in the running server.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CAMPUS_CENTER, haversineMeters } from "../../src/lib/geo";
import type { AcademicCalendar } from "../../src/lib/calendar";

const dir = mkdtempSync(join(tmpdir(), "cosign-discover-"));
const dbPath = join(dir, "seeded.db");
// db.ts reads COSIGN_DB at module load, so anything that touches it has to be
// imported after this line (see logs.test.ts for the same dance).
process.env.COSIGN_DB = dbPath;

const { closeDb, createDb, getDb } = await import("../db/db");
// Windows will not unlink a file SQLite still holds open, and the shared
// connection outlives the tests unless it is closed here first.
afterAll(() => {
  closeDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the OS will clear its own temp directory */
  }
});
const { runSeed, DEFAULT_SEED_DIR } = await import("../db/seed");
const { discover } = await import("./discover");
const { app } = await import("../index");
const { makeSessionCookie } = await import("../auth/cookie");

runSeed(dbPath, DEFAULT_SEED_DIR);
const db = getDb();

const CALENDAR: AcademicCalendar = JSON.parse(
  readFileSync(join(DEFAULT_SEED_DIR, "academic-calendar.json"), "utf-8"),
);

// Both are WEDNESDAYS at 2pm, so the shops that are open are exactly the same
// set — the only thing that differs between these two runs is the phase.
//
// They were Thursdays until 2026-08-18, when the seeded calendar was checked
// against what the registrar actually publishes and Autumn's `finals_start`
// turned out to be the last day of INSTRUCTION rather than the first day of
// finals — two days early, in both autumn terms and neither spring one. The
// old FINALS date (Thu 2026-12-10) is mid-semester under the corrected
// calendar, so it moved rather than the calendar bending to fit the test.
const MID_SEMESTER = new Date("2026-10-14T14:00:00-04:00");
const FINALS = new Date("2026-12-16T14:00:00-05:00");

type View = ReturnType<typeof discover>;
const ids = (v: View) => v.entries.map((e) => e.id);
const entry = (v: View, id: string) => v.entries.find((e) => e.id === id)!;

describe("the hero query follows the stubbed position", () => {
  it("answers from the campus centre by default", () => {
    const view = discover(db, CALENDAR, { now: MID_SEMESTER });
    expect(view.at).toEqual(CAMPUS_CENTER);
    expect(view.hero.shop_id).toBeTruthy();
  });

  it("only ever answers with somewhere open, near, and with an outlet", () => {
    const view = discover(db, CALENDAR, { now: MID_SEMESTER });
    const hero = entry(view, view.hero.shop_id!);
    expect(hero.open_now).toBe(true);
    expect(hero.amenities!.outlet_count!).toBeGreaterThan(0);
    expect(hero.walk_min).toBeLessThanOrEqual(25);
  });

  it("gives a different answer from a different position", () => {
    const fromCampus = discover(db, CALENDAR, { now: MID_SEMESTER });
    expect(fromCampus.hero.shop_id).toBe("s_juniper"); // three minutes off the Oval

    // Stand on The Foundry's doorstep, twenty minutes south-east, and it is
    // the answer instead — the query is unchanged, the position is not.
    const atFoundry = { lat: 39.9925, lng: -82.9964 };
    const fromFoundry = discover(db, CALENDAR, { now: MID_SEMESTER, at: atFoundry });
    expect(fromFoundry.at).toEqual(atFoundry);
    expect(fromFoundry.hero.shop_id).toBe("s_foundry");
    expect(entry(fromFoundry, "s_foundry").walk_min).toBe(0);
    expect(entry(fromFoundry, "s_juniper").walk_min).toBeGreaterThan(15);
  });

  it("has no answer at all from somewhere with nothing in walking range", () => {
    // Two miles west of campus, past the far end of the seeded map.
    const view = discover(db, CALENDAR, { now: MID_SEMESTER, at: { lat: 39.9812, lng: -83.0458 } });
    expect(view.hero.shop_id).toBeNull();
    expect(view.hero.matches).toBe(0);
    // ...and the list is still there, because the list is not the query.
    expect(view.entries.length).toBeGreaterThanOrEqual(20);
  });

  it("recomputes every distance from that position, not from the campus", () => {
    const at = { lat: 39.9812, lng: -83.0458 };
    for (const e of discover(db, CALENDAR, { now: MID_SEMESTER, at }).entries) {
      expect(e.distance_m, e.name).toBe(Math.round(haversineMeters(at, e)));
    }
  });

  it("picks the nearest match, not merely a match", () => {
    const view = discover(db, CALENDAR, { now: MID_SEMESTER });
    const matches = view.entries.filter(
      (e) => e.open_now && (e.amenities?.outlet_count ?? 0) > 0 && e.walk_min <= 25,
    );
    expect(matches.length).toBe(view.hero.matches);
    const nearest = Math.min(...matches.map((m) => m.walk_min));
    expect(entry(view, view.hero.shop_id!).walk_min).toBe(nearest);
  });

  it("has no answer at 4am on a Tuesday, which is a designed state, not a failure", () => {
    // Nothing on the seeded High Street is open then — Night Owl shuts at
    // two and The All-Nighter only runs around the clock Thursday to Sunday.
    const view = discover(db, CALENDAR, { now: new Date("2026-10-13T04:00:00-04:00") });
    expect(view.entries.some((e) => e.open_now)).toBe(false);
    expect(view.hero.shop_id).toBeNull();
    expect(view.hero.matches).toBe(0);
  });
});

describe("mocked finals week changes the answer", () => {
  const usual = discover(db, CALENDAR, { now: MID_SEMESTER });
  const finals = discover(db, CALENDAR, { now: FINALS });

  it("reads the phase off the committed calendar", () => {
    expect(usual.phase).toBe("mid_semester");
    expect(usual.hero.mode).toBe("usual");
    expect(finals.phase).toBe("finals");
    expect(finals.hero.mode).toBe("finals");
    expect(finals.semester).toBe("2026-autumn");
  });

  it("is looking at exactly the same shops — both are a Thursday at 2pm", () => {
    const open = (v: typeof usual) => v.entries.filter((e) => e.open_now).map((e) => e.id).sort();
    expect(open(finals)).toEqual(open(usual));
    expect(finals.hero.matches).toBe(usual.hero.matches);
  });

  it("still answers with the same query, and lands somewhere else", () => {
    expect(finals.hero.shop_id).not.toBe(usual.hero.shop_id);
    const hero = entry(finals, finals.hero.shop_id!);
    expect(hero.open_now).toBe(true);
    expect(hero.amenities!.outlet_count!).toBeGreaterThan(0);
    expect(hero.walk_min).toBeLessThanOrEqual(25);
  });

  it("answers with somewhere you can actually sit for four hours", () => {
    const hero = entry(finals, finals.hero.shop_id!);
    expect(hero.camp_ok).toBe(true);
    // ...and the longest-open of those, which is the whole point in week 15
    const campable = finals.entries.filter(
      (e) => e.camp_ok && e.open_now && (e.amenities?.outlet_count ?? 0) > 0 && e.walk_min <= 25,
    );
    expect(hero.closes_in_min).toBe(Math.max(...campable.map((c) => c.closes_in_min ?? 0)));
  });
});

describe("friends outrank the crowd, at any crowd size", () => {
  // Lena, not Maya. Maya's friends have between them ranked all 22 seeded
  // places, so her Home holds nothing for the friend tier to outrank and the
  // guarantee below was vacuously true for her — the `if` that used to guard
  // it never once ran its comparison. Lena's two friends have ranked 17 of
  // the 22, which is the only shape in which the tier is visible at all.
  const VIEWER = "u_lena";

  it("puts every place her people have ranked above every place they have not", () => {
    const view = discover(db, CALENDAR, { now: MID_SEMESTER, viewerId: VIEWER });
    const known = view.entries.map((e) => e.friend_count > 0);
    const lastKnown = known.lastIndexOf(true);
    const firstUnknown = known.indexOf(false);
    // Both halves have to exist or the comparison below compares nothing —
    // this used to guard the tier check with `if (firstUnknown !== -1)`, which
    // is green on a list with no strangers on it at all, i.e. on exactly the
    // seed change that would stop the guarantee being tested.
    expect(lastKnown, "the seed gives her places her friends have ranked").toBeGreaterThanOrEqual(0);
    expect(firstUnknown, "...and places they have not, to outrank").toBeGreaterThanOrEqual(0);
    expect(lastKnown).toBeLessThan(firstUnknown);
  });

  it("gives her a different order from a logged-out reader's", () => {
    const mine = ids(discover(db, CALENDAR, { now: MID_SEMESTER, viewerId: VIEWER }));
    const crowd = ids(discover(db, CALENDAR, { now: MID_SEMESTER }));
    expect(mine).not.toEqual(crowd);
    expect(new Set(mine)).toEqual(new Set(crowd)); // the same places, reordered
  });

  it("holds even when the crowd is fifty deep and unanimous", () => {
    // Everyone in the school piles onto one place the viewer's friends have
    // never ranked. It must still not lead her Home: at weight three, fifty
    // strangers outvote five friends, so the tier — not the weight — is what
    // carries the guarantee.
    const scratch = createDb(join(dir, "crowded.db"));
    scratch.exec(`INSERT INTO schools (id,name) VALUES ('osu','Ohio State University');`);
    const addUser = scratch.prepare(
      "INSERT INTO users (id,username,display_name,school_id,created_at) VALUES (?,?,?,'osu','2026-01-01T00:00:00Z')",
    );
    const addShop = scratch.prepare(
      "INSERT INTO shops (id,slug,name,address,lat,lng,school_id,student_discount,created_at) VALUES (?,?,?,'1 High St',40.0007,-83.0114,'osu',0,'2026-01-01T00:00:00Z')",
    );
    const addEntry = scratch.prepare(
      "INSERT INTO ranking_entries (user_id,shop_id,position,inserted_at) VALUES (?,?,?,'2026-01-01T00:00:00Z')",
    );
    addUser.run("u_me", "me", "Me");
    addUser.run("u_pal", "pal", "Pal");
    addShop.run("s_crowd", "crowd", "Crowd Favourite");
    addShop.run("s_friend", "friend", "Pal's Place");
    scratch
      .prepare(
        "INSERT INTO friendships (id,user_id,friend_id,status,created_at) VALUES ('f1','u_me','u_pal','accepted','2026-01-01T00:00:00Z')",
      )
      .run();
    addEntry.run("u_pal", "s_friend", 1); // the friend's number one
    addEntry.run("u_pal", "s_crowd", 2); // ...and their last
    for (let i = 0; i < 50; i++) {
      addUser.run(`u_x${i}`, `x${i}`, `X${i}`);
      addEntry.run(`u_x${i}`, "s_crowd", 1);
      addEntry.run(`u_x${i}`, "s_friend", 2);
    }
    // Both are on the friend's list, so the tier is tied and their own
    // ordering has to decide it — against fifty people who say the opposite.
    // A weighted mean loses this at any fixed weight; that is the whole
    // reason the friend score has no stranger in its arithmetic.
    expect(ids(discover(scratch, CALENDAR, { now: MID_SEMESTER, viewerId: "u_me" }))).toEqual([
      "s_friend",
      "s_crowd",
    ]);

    // Take the crowd favourite off the friend's list entirely and it drops a
    // whole tier: nobody the viewer knows has been there at all.
    scratch.prepare("DELETE FROM ranking_entries WHERE user_id='u_pal' AND shop_id='s_crowd'").run();
    expect(ids(discover(scratch, CALENDAR, { now: MID_SEMESTER, viewerId: "u_me" }))).toEqual([
      "s_friend",
      "s_crowd",
    ]);

    // ...and a logged-out reader gets the crowd's answer, unchanged.
    expect(ids(discover(scratch, CALENDAR, { now: MID_SEMESTER }))).toEqual(["s_crowd", "s_friend"]);
    scratch.close();
  });

  it("names the friends behind a place, and only them", () => {
    const view = discover(db, CALENDAR, { now: MID_SEMESTER, viewerId: VIEWER });
    const withFriends = view.entries.filter((e) => e.friends.length > 0);
    expect(withFriends.length).toBeGreaterThan(0);
    for (const e of withFriends) {
      for (const f of e.friends) {
        expect(f.position).toBeGreaterThan(0);
        expect(f.display_name).toBeTruthy();
      }
      expect(e.cosign_total).toBe(e.friends.length + e.others + (e.you === null ? 0 : 1));
    }
  });
});

describe("every row says how old it is", () => {
  it("labels the whole list", () => {
    const view = discover(db, CALENDAR, { now: new Date("2026-08-15T12:00:00-04:00") });
    for (const e of view.entries) {
      expect(e.age.label, e.name).toMatch(/^(checked|not checked since|never checked)/);
      expect(e.age.stale).toBe(e.stale);
    }
  });

  it("has fresh places and stale places to show, from the committed seed", () => {
    const view = discover(db, CALENDAR, { now: new Date("2026-08-15T12:00:00-04:00") });
    expect(view.entries.filter((e) => e.age.stale).length).toBeGreaterThan(0);
    expect(view.entries.filter((e) => !e.age.stale).length).toBeGreaterThan(0);
    // Cardinal & Vine was last checked on 2026-03-28 — the oldest in the seed.
    expect(entry(view, "s_cardinal-and-vine").age.label).toBe("not checked since March");
  });
});

// ── the route, which is only a wrapper, but a wrapper with a promise on it ──

const call = (path: string, as: string | null = null) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      headers: as ? { Cookie: makeSessionCookie(as).split(";")[0] } : {},
    }),
  );

describe("GET /api/discover", () => {
  it("works logged out", async () => {
    const res = await call("/api/discover");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[]; at: unknown };
    expect(body.entries.length).toBeGreaterThanOrEqual(20);
    expect(body.at).toEqual(CAMPUS_CENTER);
  });

  it("uses the position it is handed", async () => {
    const res = await call("/api/discover?lat=39.9812&lng=-83.0458");
    const body = (await res.json()) as { at: { lat: number; lng: number } };
    expect(body.at).toEqual({ lat: 39.9812, lng: -83.0458 });
  });

  it("falls back to the campus centre rather than trusting nonsense", async () => {
    for (const q of ["?lat=abc&lng=-83", "?lat=999&lng=-83", "?lat=40", "?lat=&lng=", ""]) {
      const body = (await (await call(`/api/discover${q}`)).json()) as { at: unknown };
      expect(body.at, q).toEqual(CAMPUS_CENTER);
    }
  });

  it("shows a signed-in viewer their friends, and a logged-out one nobody", async () => {
    const mine = (await (await call("/api/discover", "u_maya")).json()) as {
      entries: Array<{ friends: unknown[] }>;
    };
    const theirs = (await (await call("/api/discover")).json()) as {
      entries: Array<{ friends: unknown[] }>;
    };
    expect(mine.entries.some((e) => e.friends.length > 0)).toBe(true);
    expect(theirs.entries.every((e) => e.friends.length === 0)).toBe(true);
  });

  it("stores the position nowhere — no row, no event, no log", async () => {
    // A coordinate nobody would produce by accident, swept for afterwards
    // across every text column in the database (decision 12: location is
    // read momentarily and never stored).
    const needle = "41.987654";
    await call(`/api/discover?lat=${needle}&lng=-87.123456`);
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as unknown as Array<{ name: string }>
    ).map((t) => t.name);
    expect(tables.length).toBeGreaterThan(10);
    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM "${table}"`).all();
      expect(JSON.stringify(rows).includes(needle), `${needle} found in ${table}`).toBe(false);
      expect(JSON.stringify(rows).includes("87.123456"), `longitude found in ${table}`).toBe(false);
    }
  });
});
