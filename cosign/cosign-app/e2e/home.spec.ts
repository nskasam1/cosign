// Phase 4 acceptance: Home, discovery, freshness and the shell.
//
//   bash scripts/phase4-evidence.sh          # owns its servers and databases
//
// Two servers are involved. The main one is the app as it ships. The second
// (COSIGN_FINALS_BASE) is the same build pointed at a calendar fixture whose
// finals week contains today — that is the "mocked finals week" the phase
// asks for, and it is a FILE, not a hook: nothing in the running server can
// move the date. The finals tests skip when that base is not set.
//
// Some of these WRITE (the re-verify prompt is a write), so they run against
// a scratch database like the Phase 3 suite does.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EVIDENCE,
  expectNoRatingScale,
  expectTapTargets,
  settled,
  shot,
  shotViewport,
  signIn,
  signInAsNewUser,
} from "./fixtures";

const FINALS_BASE = process.env.COSIGN_FINALS_BASE;

/**
 * The seeded viewer these tests read as. Lena has two accepted friends
 * (June and Theo) and a six-place list of her own, so her Home cannot look
 * like the crowd's — and her pending request to Maya is the case that
 * proves "accepted friends only" is not "anyone who asked".
 */
const VIEWER = "u_lena";

interface Entry {
  id: string;
  name: string;
  slug: string;
  open_now: boolean;
  walk_min: number;
  amenities: { outlet_count: number | null } | null;
  friend_count: number;
  friends: Array<{ username: string; display_name: string; position: number }>;
  // `days` is null for a place nobody has ever checked, which is also stale —
  // so every reader below coalesces rather than comparing null to a number.
  age: { days: number | null; stale: boolean; label: string };
  camp_ok: boolean;
  closes_in_min: number | null;
}
interface View {
  at: { lat: number; lng: number };
  phase: string;
  hero: { mode: string; shop_id: string | null; matches: number };
  entries: Entry[];
}

const discover = async (page: Page, qs = "", base = ""): Promise<View> => {
  const res = await page.request.get(`${base}/api/discover${qs}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as View;
};

const rowIds = (page: Page, scope: string) =>
  page.locator(`${scope} [data-place]`).evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-shop-id")!),
  );

test.describe("the hero query", () => {
  test("is the page's question, and it has already been answered", async ({ page, context }, testInfo) => {
    await signIn(context, "u_lena");

    // The momentary position read has to actually reach the server: this is
    // the whole GeoProvider seam, so the request is inspected, not assumed.
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/discover")) asked.push(new URL(r.url()).search);
    });

    await page.goto("/");
    await expect(page.locator("[data-home][data-state]")).toHaveCount(0);
    await expect(page.locator("[data-elsewhere]")).toBeVisible();
    await expect(page.locator("[data-hero-query]")).toHaveText(/near me, open now, has outlets/i);

    expect(asked.length, "Home asks the discovery route exactly once").toBe(1);
    // The stub is the fixed campus coordinate (src/lib/geo.ts).
    expect(asked[0], "the momentary position is handed over on the query string").toMatch(
      /lat=40\.0007&lng=-83\.0114/,
    );

    const view = await discover(page);
    if (view.hero.shop_id) {
      const hero = view.entries.find((e) => e.id === view.hero.shop_id)!;
      const rendered = page.locator("[data-answer] [data-place][data-lead]");
      await expect(rendered).toHaveAttribute("data-shop-id", hero.id);
      // ...and it really does answer the question it is under.
      expect(hero.open_now, `${hero.name} is open`).toBe(true);
      expect(hero.amenities?.outlet_count ?? 0, `${hero.name} has outlets`).toBeGreaterThan(0);
      expect(hero.walk_min, `${hero.name} is within a walk`).toBeLessThanOrEqual(25);
      // the nearest of the matches, not merely one of them
      const matches = view.entries.filter(
        (e) => e.open_now && (e.amenities?.outlet_count ?? 0) > 0 && e.walk_min <= 25,
      );
      expect(hero.walk_min).toBe(Math.min(...matches.map((m) => m.walk_min)));
    } else {
      await expect(page.locator('[data-answer="none"] [data-nothing]')).toBeVisible();
    }

    await shotViewport(page, "home", testInfo.project.name);
    await expectNoRatingScale(page, "home");
  });

  test("follows the position it is given, rather than a place it likes", async ({ page, context }) => {
    await signIn(context, "u_lena");
    const fromCampus = await discover(page);
    // The Foundry's own doorstep, twenty minutes south-east of the Oval.
    const fromFoundry = await discover(page, "?lat=39.9925&lng=-82.9964");
    expect(fromFoundry.at).toEqual({ lat: 39.9925, lng: -82.9964 });
    expect(fromFoundry.entries.find((e) => e.slug === "foundry")!.walk_min).toBe(0);
    expect(fromFoundry.hero.shop_id).not.toBe(fromCampus.hero.shop_id);

    // Two miles west there is nothing inside a walk at all, and that is a
    // designed state rather than a failure.
    const fromNowhere = await discover(page, "?lat=39.9812&lng=-83.0458");
    expect(fromNowhere.hero.shop_id).toBeNull();
    expect(fromNowhere.hero.matches).toBe(0);
    expect(fromNowhere.entries.length).toBeGreaterThanOrEqual(20);
  });

  test("stores nothing about where you are", async ({ page, context }) => {
    await signIn(context, "u_lena");
    await page.goto("/");
    await expect(page.locator("[data-home][data-state]")).toHaveCount(0);
    await expect(page.locator("[data-elsewhere]")).toBeVisible();
    // Nothing client-side keeps it either — no storage, no cookie beyond the
    // session, no query string left in the address bar.
    const kept = await page.evaluate(() => ({
      local: JSON.stringify(Object.entries(localStorage)),
      session: JSON.stringify(Object.entries(sessionStorage)),
      url: location.href,
    }));
    expect(kept.local).not.toMatch(/40\.0007|-83\.0114/);
    expect(kept.session).not.toMatch(/40\.0007|-83\.0114/);
    expect(kept.url).not.toMatch(/lat=|lng=/);
    await expect(page.locator("[data-ask-again]")).toContainText(/not kept/i);
  });
});

test.describe("friends outrank the crowd, and you can see it", () => {
  test("orders the column by your people, and shows you the order you're not being given", async ({
    page,
    context,
  }, testInfo) => {
    await signIn(context, VIEWER); // lena: two friends, a short list
    const view = await discover(page);
    expect(view.entries.some((e) => e.friend_count > 0), "the fixture viewer has friends").toBe(true);

    await page.goto("/");
    await expect(page.locator('[data-elsewhere][data-order="friends"]')).toBeVisible();
    const friendsOrder = await rowIds(page, "[data-elsewhere]");

    // The page renders the route's column, in the route's order — Home takes
    // out the rows that answered the hero query and reorders nothing.
    const known = new Map(view.entries.map((e) => [e.id, e.friend_count > 0]));
    expect(
      friendsOrder.filter((id) => !known.has(id)),
      "every rendered row is a row the route answered with",
    ).toEqual([]);
    const onScreen = new Set(friendsOrder);
    expect(friendsOrder, "the page shows the order it was handed").toEqual(
      view.entries.map((e) => e.id).filter((id) => onScreen.has(id)),
    );

    // ...and that order puts every place her people have ranked above every
    // place they have not. Both halves have to exist or the comparison
    // compares nothing, which is what went wrong here: the guarantee sat
    // behind `if (firstUnknown !== -1)`, and the rendered slice is whatever
    // the hero query left behind — at two on a Thursday that is three rows,
    // all of them her friends'. So it is checked against the whole column,
    // where the seed reliably has both, and the rendered order is tied to
    // that column by the assertion above.
    const flags = view.entries.map((e) => e.friend_count > 0);
    const lastKnown = flags.lastIndexOf(true);
    const firstUnknown = flags.indexOf(false);
    expect(lastKnown, "her friends have ranked somewhere").toBeGreaterThanOrEqual(0);
    expect(firstUnknown, "...and there is somewhere left for them to outrank").toBeGreaterThanOrEqual(0);
    expect(lastKnown).toBeLessThan(firstUnknown);

    // The claim is checkable in the product, not only in a test file.
    const moved = page.locator("[data-moved]");
    await expect(moved).toContainText(/\d+ of \d+ move when your friends count for more/);
    const stated = Number((await moved.innerText()).match(/^(\d+)/)![1]);

    await page.locator("[data-crowd-toggle]").click();
    await expect(page.locator('[data-elsewhere][data-order="crowd"]')).toBeVisible();
    const crowdOrder = await rowIds(page, "[data-elsewhere]");

    expect(crowdOrder).not.toEqual(friendsOrder);
    expect(new Set(crowdOrder)).toEqual(new Set(friendsOrder));
    const actuallyMoved = friendsOrder.filter((id, i) => crowdOrder[i] !== id).length;
    expect(actuallyMoved, "the number on screen is the number of places that move").toBe(stated);
    expect(actuallyMoved).toBeGreaterThan(0);
    await shotViewport(page, "home-crowd-order", testInfo.project.name, 1000);

    writeFileSync(
      join(EVIDENCE, `friend-vs-crowd-${testInfo.project.name}.json`),
      JSON.stringify({ viewer: VIEWER, moved: actuallyMoved, of: friendsOrder.length, friendsOrder, crowdOrder }, null, 2),
    );
  });

  test("names friends and counts everyone else, two names at most", async ({ page, context }) => {
    await signIn(context, VIEWER);
    const view = await discover(page);
    const friendNames = new Set(
      view.entries.flatMap((e) => e.friends.map((f) => f.display_name.split(" ")[0])),
    );
    expect(friendNames.size).toBeGreaterThan(0);

    await page.goto("/");
    await expect(page.locator("[data-home][data-state]")).toHaveCount(0);
    await expect(page.locator("[data-elsewhere]")).toBeVisible();
    const lines = await page.locator("[data-who]").allInnerTexts();
    expect(lines.length).toBeGreaterThan(0);

    // Nobody outside the friend set is ever named — not even the three
    // seeded users whose rankings are public, which the share page may name.
    //
    // Checked against the SERVER's own view of who the viewer may read,
    // not against the same `friends` array that produced the names: if
    // friendSignals misclassified a stranger, that stranger would appear in
    // both the DOM and the array, and comparing them would agree with
    // itself. `/api/users/:username` answers `can_see_ranking` from the
    // friendship graph independently.
    const allUsers = (await (await page.request.get("/api/auth/users")).json()) as {
      users: Array<{ username: string; display_name: string }>;
    };
    const readable = new Map<string, boolean>();
    for (const u of allUsers.users) {
      const profile = (await (await page.request.get(`/api/users/${u.username}`)).json()) as {
        can_see_ranking: boolean;
        is_self: boolean;
      };
      readable.set(u.display_name.split(" ")[0], profile.can_see_ranking && !profile.is_self);
    }

    for (const line of lines) {
      const named = allUsers.users
        .map((u) => u.display_name.split(" ")[0])
        .filter((n) => new RegExp(`\\b${n}\\b`).test(line));
      expect(named.length, `"${line}" names at most two people`).toBeLessThanOrEqual(2);
      for (const n of named) {
        expect(readable.get(n), `"${line}" names ${n}, whose ranking this viewer cannot open`).toBe(true);
      }
    }
    expect(friendNames.size, "somebody was actually named").toBeGreaterThan(0);
  });

  test("degrades honestly for someone with no friends at all", async ({ page, context }, testInfo) => {
    await signInAsNewUser(context, "alone");
    await page.goto("/");
    await expect(page.locator("[data-elsewhere]")).toContainText(/add a friend/i);
    await expect(page.locator("[data-crowd-toggle]")).toHaveCount(0); // no other order to show
    await shotViewport(page, "home-no-friends", testInfo.project.name, 900);

    // ...and it stays honest once they have ranked something of their own.
    // `friend_count` includes the viewer's own list, so keying the copy off
    // it would flip a solo account to "who'd send you there" the moment it
    // ranked one place — with nobody but themself in the order.
    const first = (await discover(page)).entries[0];
    const inserted = await page.request.post("/api/rankings/insert", {
      data: { shop_id: first.id, position: 1, comparisons: [] },
    });
    expect(inserted.status(), await inserted.text()).toBe(201);
    await page.reload();
    await expect(page.locator("[data-elsewhere]")).toContainText(/add a friend/i);
    await expect(page.locator("[data-crowd-toggle]")).toHaveCount(0);
  });
});

test.describe("the designed states nobody plans to see", () => {
  test("Home says so plainly when the query has no answer", async ({ page, context }, testInfo) => {
    // Home always asks from the stub's fixed campus coordinate, so the only
    // way to reach this branch in a browser is for the whole street to be
    // shut. The route's real answers for a closed campus are covered in
    // server/repo/discover.test.ts ("no answer at 4am on a Tuesday"); what
    // is under test HERE is only that the screen renders it as a written
    // answer rather than as an empty column.
    await signIn(context, VIEWER);
    // Nothing is fabricated: the SPA's request is answered with the SERVER's
    // own answer from a position two miles west of campus, where the hero
    // query genuinely has nothing to return. Only the coordinate is swapped,
    // because Home always asks from the stub's fixed campus centre.
    await page.route("**/api/discover*", async (route) => {
      const nowhere = await route.fetch({ url: `${new URL(route.request().url()).origin}/api/discover?lat=39.9812&lng=-83.0458` });
      route.fulfill({ response: nowhere });
    });
    await page.goto("/");
    const none = page.locator('[data-answer="none"] [data-nothing]');
    await expect(none).toBeVisible();
    await expect(none).toContainText(/nothing near you is open with an outlet/i);
    await expect(page.locator("[data-hero-summary]")).toContainText(/nothing inside 25 minutes/i);
    // The column is still the column: an unanswerable question is not an
    // empty app.
    await expect(page.locator("[data-elsewhere] [data-place]").first()).toBeVisible();
    await shotViewport(page, "home-no-answer", testInfo.project.name);
    await expectNoRatingScale(page, "home with no answer");
  });
});

/**
 * A place the server has just been told is still right — MADE fresh, not
 * found fresh, and returned as the entry it was before the confirmation.
 *
 * STALE_AFTER_DAYS is counted off the real clock while every last_verified_at
 * in the seed is a fixed date, so the newest of them (2026-08-14) leaves the
 * fresh band on 2026-09-04 and crosses into stale on 2026-10-13. A test that
 * SEARCHED the seed for a fresh row therefore had an expiry date of its own:
 * after that Tuesday the whole campus is stale and there is nothing to find,
 * and the Phase 4 suite fails for a reason that has nothing to do with the
 * code. So the state is created through the product's own route — a throwaway
 * account logs a visit and confirms the facts, which is exactly the write the
 * re-verify prompt makes — and every later assertion is derived from what the
 * server says afterwards.
 *
 * It confirms whichever place the data already calls the freshest, so the
 * write moves one row by at most one band and never touches the stale end of
 * the column that the rest of this suite draws its fixtures from.
 */
async function freshlyChecked(page: Page, context: BrowserContext): Promise<Entry> {
  await signInAsNewUser(context, "checked");
  // A place nobody has ever checked has no age at all, and sorts to the far
  // end rather than to the front of a "freshest first" list.
  const freshest = [...(await discover(page)).entries].sort(
    (a, b) => (a.age.days ?? 1e9) - (b.age.days ?? 1e9),
  )[0];
  const logged = await page.request.post("/api/logs", {
    data: { shop_id: freshest.id, intent_tag: "deep_work" },
  });
  expect(logged.status(), await logged.text()).toBe(201);
  const confirmed = await page.request.post(`/api/shops/${freshest.id}/verify`);
  expect(confirmed.status(), await confirmed.text()).toBe(200);
  return freshest;
}

test.describe("freshness", () => {
  test("says how old every row is, and stays quiet when it is fresh", async ({ page, context }) => {
    // The fresh row is created before the page is read (freshlyChecked), so
    // the quiet band is still exercised on a day when nothing in the seed is
    // young enough to exercise it.
    const checked = await freshlyChecked(page, context);
    await signIn(context, VIEWER);
    const view = await discover(page);

    // The bands are derived from the data, not asserted against the calendar.
    const band = (e: Entry) => (e.age.stale ? "stale" : (e.age.days ?? 0) < 21 ? "fresh" : "aging");
    const expected = new Map(view.entries.map((e) => [e.id, band(e)]));
    expect(expected.get(checked.id), `${checked.name} was just confirmed, so it reads as fresh`).toBe(
      "fresh",
    );
    expect(new Set(expected.values()).size, "and something older is on screen beside it").toBeGreaterThan(1);

    await page.goto("/");
    await expect(page.locator("[data-home][data-state]")).toHaveCount(0);
    await expect(page.locator("[data-elsewhere]")).toBeVisible();

    // Every rendered row is in the band the data says it is in, and says
    // exactly as much about its age as that band allows.
    const rows = await page.locator("[data-place]").all();
    expect(rows.length).toBeGreaterThanOrEqual(20);
    let sawDated = false;
    let sawSilent = false;
    for (const row of rows) {
      const id = (await row.getAttribute("data-shop-id"))!;
      const want = expected.get(id)!;
      await expect(row.locator("[data-facts]")).toHaveAttribute("data-freshness", want);
      const ageCount = await row.locator("[data-age]").count();
      if (want === "fresh") {
        expect(ageCount, `${id} is fresh, so it should say nothing about its age`).toBe(0);
        sawSilent = true;
      } else {
        expect(ageCount, `${id} is ${want}, so it should say so`).toBe(1);
        const text = await row.locator("[data-age]").innerText();
        expect(text).toMatch(want === "stale" ? /not checked since|never checked/i : /checked/i);
        sawDated = true;
      }
    }
    // Both halves of the claim, and both are guaranteed by the data rather
    // than hoped for: the fresh row is the one this test confirmed, and the
    // dated row is whatever else the band spread above found. The old
    // `sawStale || sawSilent` passed on either one, so it went on passing
    // after 2026-09-04 while quietly testing only half the title.
    expect(sawSilent, "the row this test confirmed says nothing at all about its age").toBe(true);
    expect(sawDated, "and a row on the other side of the line says how old it is").toBe(true);
  });

  test("asks the person who was last through the door, and only them", async ({ page, context }, testInfo) => {
    // Builds its own fixture rather than borrowing a seeded pair. Answering
    // the prompt WRITES a verification date, so a hard-coded shop works
    // exactly once and the second run finds the state its own first run
    // created — the Phase 3 lesson, applied here before it bites.
    await signInAsNewUser(context, "door");
    const stalest = (await discover(page)).entries
      .filter((e) => e.age.stale)
      .sort((a, b) => (b.age.days ?? 0) - (a.age.days ?? 0))[0];
    expect(stalest, "the seed always leaves something nobody has checked").toBeTruthy();
    const logged = await page.request.post("/api/logs", {
      data: { shop_id: stalest.id, intent_tag: "deep_work" },
    });
    expect(logged.status(), await logged.text()).toBe(201);

    await page.goto(`/shop/${stalest.slug}`);
    await expect(page.locator("[data-shop][data-stale]")).toBeVisible();

    const ask = page.locator("[data-reverify][data-revisit]");
    await expect(ask).toBeVisible();
    await expect(ask).toContainText(/last person through the door/i);
    await expect(ask.locator("[data-last-visit]")).toBeVisible();
    await expect(page.locator("[data-verify]")).toBeVisible();
    await shotViewport(page, "shop-reverify", testInfo.project.name);
    await expectNoRatingScale(page, "shop detail");
    await expectTapTargets(page, "the re-verify prompt");
    // Audited HERE, while the prompt is on screen. The quality-gate sweep
    // below runs after this test has answered it, so by then this page no
    // longer has the surface that most needed auditing — the Phase 3 trap,
    // where the axe run only ever reached the already-ranked done screen.
    await auditSurface(page, "shop-reverify", testInfo.project.name);

    // Answering it writes the date and says so.
    const verified = page.waitForResponse((r) => r.url().includes("/verify") && r.request().method() === "POST");
    await page.locator("[data-verify]").click();
    expect((await verified).status()).toBe(200);
    await expect(page.locator("[data-verified]")).toBeVisible();
    await expect(page.locator("[data-reverify]")).toHaveCount(0);
    await expect(page.locator("[data-age]").first()).toContainText(/checked today/i);
    await shotViewport(page, "shop-verified", testInfo.project.name);
  });

  test("tells everyone else, but does not ask them to vouch for it", async ({ page, context }, testInfo) => {
    // A brand-new account has been nowhere, so every stale place on campus
    // is one it cannot answer for. No seeded pair to go out of date.
    await signInAsNewUser(context, "stranger");
    const stale = (await discover(page)).entries.find((e) => e.age.stale)!;
    expect(stale).toBeTruthy();
    await page.goto(`/shop/${stale.slug}`);
    await expect(page.locator("[data-shop][data-stale]")).toBeVisible();
    await expect(page.locator("[data-reverify]")).toBeVisible();
    await expect(page.locator("[data-reverify][data-revisit]")).toHaveCount(0);
    await expect(page.locator("[data-verify]")).toHaveCount(0);
    await expect(page.locator("[data-reverify]")).toContainText(/rumour/i);
    await shotViewport(page, "shop-stale-stranger", testInfo.project.name);
  });

  test("a fresh place is not asked about at all", async ({ page, context }) => {
    // Created rather than chosen (freshlyChecked). Searching the data for an
    // unstale row was already better than naming a slug, but it still had an
    // expiry date: on 2026-10-13 the last seeded check passes
    // STALE_AFTER_DAYS and the filter comes back empty.
    const checked = await freshlyChecked(page, context);
    await signIn(context, VIEWER);
    const age = (await discover(page)).entries.find((e) => e.id === checked.id)!.age;
    expect(age.stale, `${checked.name} was confirmed a moment ago`).toBe(false);
    await page.goto(`/shop/${checked.slug}`);
    await expect(page.locator("[data-shop]")).toBeVisible();
    await expect(page.locator("[data-shop][data-stale]")).toHaveCount(0);
    await expect(page.locator("[data-reverify]")).toHaveCount(0);
  });

  test("the server refuses a confirmation from somebody who has not been in", async ({ page, context }) => {
    // The screen only offers the button to the last person through the door;
    // the route has to enforce it too, or the freshness signal the whole of
    // brief #10 rests on is a client-side suggestion.
    await signInAsNewUser(context, "vouch");
    const stale = (await discover(page)).entries.find((e) => e.age.stale)!;
    const refused = await page.request.post(`/api/shops/${stale.id}/verify`);
    expect(refused.status(), await refused.text()).toBe(403);
    expect((await discover(page)).entries.find((e) => e.id === stale.id)!.age.stale).toBe(true);

    // ...and accepts it from somebody who has, which is the same route.
    const logged = await page.request.post("/api/logs", {
      data: { shop_id: stale.id, intent_tag: "deep_work" },
    });
    expect(logged.status()).toBe(201);
    const allowed = await page.request.post(`/api/shops/${stale.id}/verify`);
    expect(allowed.status(), await allowed.text()).toBe(200);
    expect((await discover(page)).entries.find((e) => e.id === stale.id)!.age.stale).toBe(false);
  });
});

test.describe("the shell", () => {
  test("is four words, and Log is the one that writes", async ({ page, context }, testInfo) => {
    await signIn(context, VIEWER);
    await page.goto("/");
    const tabs = page.locator("[data-shell] [data-tab]");
    await expect(tabs).toHaveCount(4);
    // Three of the four are small-capsed by CSS; Log is set in the display
    // face in title case, which is how it is primary without an icon.
    expect((await tabs.allInnerTexts()).map((t) => t.toLowerCase())).toEqual([
      "home",
      "search",
      "log",
      "you",
    ]);
    await expect(page.locator('[data-tab="log"]')).toHaveText("Log");
    await expect(page.locator('[data-tab="home"]')).toHaveAttribute("aria-current", "page");
    await expectTapTargets(page, "the shell on home");

    await page.locator('[data-tab="search"]').click();
    await expect(page.locator("[data-search]")).toBeVisible();
    await expect(page.locator('[data-tab="search"]')).toHaveAttribute("aria-current", "page");
    await shotViewport(page, "search", testInfo.project.name);

    await page.locator('[data-tab="you"]').click();
    await expect(page.locator("[data-profile]")).toBeVisible();
    await expect(page).toHaveURL(/\/lena$/);
    await shotViewport(page, "profile", testInfo.project.name);

    // Log is followed rather than merely inspected. Asserting that the tab
    // carries [data-log-entry] only restates that its key is "log"; what
    // matters is that pressing it starts the log flow, and that the shell
    // does not come with it.
    await page.locator('[data-tab="log"]').click();
    await expect(page.locator('[data-logflow][data-step="where"]')).toBeVisible();
    await expect(page.locator("[data-shell]")).toHaveCount(0);
  });

  test("is absent from the journeys, which have their own way out", async ({ page, context }) => {
    await signIn(context, VIEWER);
    for (const path of ["/log", "/onboarding"]) {
      await page.goto(path);
      await expect(page.locator("[data-shell]")).toHaveCount(0);
    }
    // ...and from the public share page, which ships no bundle at all.
    // The viewer owns no seeded token (all four belong to maya and dev), so
    // this mints one rather than sitting behind an `if` that never runs —
    // which is exactly what it did until the review pointed it out.
    const made = await page.request.post("/api/share", { data: { kind: "ranking" } });
    expect(made.status(), await made.text()).toBe(201);
    const { token } = (await made.json()) as { token: { token: string } };
    await page.goto(`/s/${token.token}`);
    await expect(page.locator("[data-shell]")).toHaveCount(0);
    await expect(page.locator("ol li").first()).toBeVisible(); // it really is the share page
    await page.request.post(`/api/share/${token.token}/revoke`);
  });
});

test.describe("empty states, designed", () => {
  test("a new account gets a written screen, not a shrug", async ({ page, context }, testInfo) => {
    await signInAsNewUser(context, "empty");
    await page.goto("/rank");
    const nothing = page.locator("[data-nothing]");
    await expect(nothing).toBeVisible();
    await expect(nothing).toContainText(/a list starts with one honest call/i);
    // No icon, no centred grey square — the Phase-1 EmptyState is gone.
    expect(await nothing.locator("svg").count()).toBe(0);
    await shotViewport(page, "empty-ranking", testInfo.project.name);

    await page.goto("/search");
    await page.locator('[data-facet="close"]').click();
    await page.locator('[data-facet="stay"]').click();
    await page.locator("[data-search-input]").fill("zzzz");
    await expect(page.locator("[data-nothing]")).toBeVisible();
    await shotViewport(page, "empty-search", testInfo.project.name);
  });
});

test.describe("search narrows on facts", () => {
  test("every chip filters, and the count says by how much", async ({ page, context }) => {
    await signIn(context, VIEWER);
    const entries = (await discover(page)).entries;
    await page.goto("/search");
    await expect(page.locator("[data-search-count]")).toContainText(`All ${entries.length}`);

    // Each facet is checked against what the data says it should keep, so
    // deleting the filter loop would fail here rather than passing quietly
    // behind a text query that had already emptied the list.
    const expectations: Array<[string, (e: Entry) => boolean]> = [
      ["open", (e) => e.open_now],
      ["outlets", (e) => (e.amenities?.outlet_count ?? 0) > 0],
      ["close", (e) => e.walk_min <= 10],
      ["stay", (e) => e.camp_ok],
    ];
    for (const [facet, matches] of expectations) {
      const want = entries.filter(matches);
      expect(want.length, `${facet} matches something in the seed`).toBeGreaterThan(0);
      expect(want.length, `${facet} excludes something in the seed`).toBeLessThan(entries.length);

      await page.locator(`[data-facet="${facet}"]`).click();
      await expect(page.locator(`[data-facet="${facet}"]`)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-search-count]")).toHaveText(
        `${want.length} of ${entries.length}`,
      );
      expect((await rowIds(page, "[data-search]")).sort()).toEqual(want.map((e) => e.id).sort());
      await page.locator(`[data-facet="${facet}"]`).click(); // and it lets go
      await expect(page.locator("[data-search-count]")).toContainText(`All ${entries.length}`);
    }

    // Two at once is an intersection, not the last one to be tapped.
    await page.locator('[data-facet="open"]').click();
    await page.locator('[data-facet="stay"]').click();
    const both = entries.filter((e) => e.open_now && e.camp_ok);
    expect((await rowIds(page, "[data-search]")).sort()).toEqual(both.map((e) => e.id).sort());
  });

  test("a failed load is not rendered as an empty campus", async ({ page, context }) => {
    // The Phase 3 lesson, one surface over: never infer from an absence.
    await signIn(context, VIEWER);
    await page.route("**/api/discover*", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto("/search");
    await expect(page.locator('[data-search][data-state="unreachable"]')).toBeVisible();
    await expect(page.locator("[data-nothing]")).toContainText(/didn't load/i);
    await expect(page.locator("[data-retry]")).toBeVisible();
    // ...and it must NOT say the campus has nothing that matches.
    await expect(page.locator("[data-nothing]")).not.toContainText(/nowhere on this campus/i);
    await expect(page.locator("[data-search-count]")).toHaveCount(0);

    // The same page recovers when the server does.
    await page.unroute("**/api/discover*");
    await page.locator("[data-retry]").click();
    await expect(page.locator("[data-search-count]")).toContainText(/^All \d+/);
  });
});

test.describe("finals week, from the calendar", () => {
  test.skip(!FINALS_BASE, "needs a server pointed at the finals calendar fixture");

  test("changes the answer, the reason, and the shape of the page", async ({ page, context }, testInfo) => {
    await signIn(context, VIEWER);

    const usual = await discover(page);
    expect(usual.hero.mode).toBe("usual");
    await page.goto("/");
    await expect(page.locator('[data-home][data-hero-mode="usual"]')).toBeVisible();
    await expect(page.locator("[data-last-call]")).toHaveCount(0);

    // The same build, the same database, a different academic calendar.
    await page.goto(`${FINALS_BASE}/`);
    await expect(page.locator('[data-home][data-hero-mode="finals"]')).toBeVisible();
    await expect(page.locator("[data-dateline]")).toContainText(/finals week/i);
    await expect(page.locator("[data-hero-summary]")).toContainText(/somewhere you can stay comes first/i);

    // A section that exists in no other week, built from shop_hours.
    await expect(page.locator("[data-last-call]")).toBeVisible();
    await expect(page.locator("[data-last-call]")).toContainText(/still open in four hours/i);

    const finals = await discover(page, "", FINALS_BASE!);
    expect(finals.phase).toBe("finals");
    expect(finals.hero.mode).toBe("finals");
    // The question is unchanged, so the match set is; the answer is not.
    expect(finals.hero.matches).toBe(usual.hero.matches);
    // Asserted, not guarded: with nothing open there is no answer to compare,
    // and the two claims below would pass vacuously at four in the morning.
    // If this fails, the run happened at an hour the seeded campus is shut —
    // which is a reason to re-run, not a reason to call the phase proven.
    expect(
      usual.hero.shop_id,
      "nothing on the seeded campus is open with an outlet at this hour — re-run in opening hours",
    ).toBeTruthy();
    expect(finals.hero.shop_id).toBeTruthy();
    expect(finals.hero.shop_id).not.toBe(usual.hero.shop_id);
    const hero = finals.entries.find((e) => e.id === finals.hero.shop_id)!;
    expect(hero.camp_ok, "finals answers with somewhere you can sit for four hours").toBe(true);
    // ...and it is the longest-open of those, which is the point in week 15.
    const campable = finals.entries.filter(
      (e) => e.camp_ok && e.open_now && (e.amenities?.outlet_count ?? 0) > 0 && e.walk_min <= 25,
    );
    expect(hero.closes_in_min).toBe(Math.max(...campable.map((c) => c.closes_in_min ?? 0)));
    await shotViewport(page, "home-finals", testInfo.project.name);
    await expectNoRatingScale(page, "home in finals week");

    writeFileSync(
      join(EVIDENCE, `finals-${testInfo.project.name}.json`),
      JSON.stringify(
        {
          usual: { phase: usual.phase, mode: usual.hero.mode, hero: usual.hero.shop_id, matches: usual.hero.matches },
          finals: { phase: finals.phase, mode: finals.hero.mode, hero: finals.hero.shop_id, matches: finals.hero.matches },
        },
        null,
        2,
      ),
    );
  });
});

/** One axe run, written out as evidence, failing on serious or critical. */
async function auditSurface(page: Page, name: string, project: string): Promise<number> {
  await settled(page);
  const run = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const bad = run.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  writeFileSync(
    join(EVIDENCE, `axe-${name}-${project}.json`),
    JSON.stringify(
      {
        url: page.url(),
        passes: run.passes.length,
        violations: run.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.map((n) => ({ html: n.html, summary: n.failureSummary })),
        })),
      },
      null,
      2,
    ),
  );
  expect(bad.map((v) => `${name} — ${v.id}: ${v.help}`).join("\n")).toBe("");
  return bad.length;
}

test.describe("the quality gates", () => {
  /**
   * The shop surface is resolved from the data rather than named. The
   * freshness suite answers the prompt on the stalest place, so a hard-coded
   * slug here would eventually be audited without the stale treatment on it
   * — which is precisely the Phase 3 failure where the axe run only ever
   * reached the screen that needed auditing least.
   */
  const surfaces = async (page: Page): Promise<Array<[string, string]>> => {
    const stale = (await discover(page)).entries.find((e) => e.age.stale);
    return [
      ["home", "/"],
      ["search", "/search"],
      ["shop", `/shop/${stale?.slug ?? "oval-grounds"}`],
      ["ranking", "/rank"],
      ["profile", "/lena"],
      // A list is a destination too, and its remove control was a 40px
      // target for exactly as long as this sweep did not visit it.
      ["list", "/lists/l_our-campus-ranking"],
    ];
  };

  test("axe finds no serious or critical violations on any destination", async ({ page, context }, testInfo) => {
    await signIn(context, VIEWER);
    const results: Record<string, number> = {};
    for (const [name, path] of await surfaces(page)) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      results[name] = await auditSurface(page, name, testInfo.project.name);
      await expectNoRatingScale(page, name);
    }
    expect(Object.values(results).every((v) => v === 0)).toBe(true);
  });

  test("every target on every destination clears 44px", async ({ page, context }) => {
    await signIn(context, VIEWER);
    for (const [name, path] of await surfaces(page)) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await settled(page);
      await expectTapTargets(page, name);
    }
  });

  test("prefers-reduced-motion removes all animation", async ({ page, context }, testInfo) => {
    await signIn(context, VIEWER);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("[data-home][data-state]")).toHaveCount(0);
    await expect(page.locator("[data-elsewhere]")).toBeVisible();
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .map((el) => {
          const s = getComputedStyle(el);
          const dur = (v: string) => v.split(",").map((x) => parseFloat(x) || 0);
          const max = Math.max(...dur(s.animationDuration), ...dur(s.transitionDuration));
          return max > 0.01 ? `${el.tagName.toLowerCase()}.${el.className}: ${max}s` : null;
        })
        .filter(Boolean),
    );
    expect(moving).toEqual([]);
    await shotViewport(page, "home-reduced-motion", testInfo.project.name);
  });

  test("the whole column, top to bottom, for the anti-slop review", async ({ page, context }, testInfo) => {
    await signIn(context, VIEWER);
    await page.goto("/");
    await expect(page.locator("[data-home][data-state]")).toHaveCount(0);
    await expect(page.locator("[data-elsewhere]")).toBeVisible();
    // The shell is sticky, so the full-page capture is taken from the bottom
    // of the document where it sits in normal flow rather than overlaying a
    // row mid-column.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shot(page, "home-full", testInfo.project.name);
    const stale = (await discover(page)).entries.find((e) => e.age.stale);
    await page.goto(`/shop/${stale?.slug ?? "oval-grounds"}`);
    // Wait for the page before measuring its height: scrolling a loading
    // screen to its "bottom" is a no-op, and the capture then stitches the
    // sticky shelf across the middle of the column.
    await expect(page.locator("[data-shop] [data-fact]").first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shot(page, "shop-full", testInfo.project.name);
  });
});
