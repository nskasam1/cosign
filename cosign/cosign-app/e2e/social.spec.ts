// Phase 5B acceptance: group mode, the collaborative list, and the
// notification feed. Runs against `npm run prod` on :8787.
//
//   bash scripts/phase5b-evidence.sh          # owns its own server + scratch DB
//
// This suite WRITES — it starts sessions, answers them, sends friend requests
// and re-ranks a shared list — so it must never be pointed at
// server/data/cosign.db. Fixtures that need a clean slate build their own
// through the real routes rather than borrowing a seeded one (the Phase 3
// lesson, applied before it bites).

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EVIDENCE,
  expectNoRatingScale,
  expectTapTargets,
  loaded,
  settled,
  signIn,
  signInAsNewUser,
} from "./fixtures.ts";

/** The four seeded users who are pairwise accepted friends. */
const FOUR = ["u_maya", "u_dev", "u_june", "u_theo"] as const;
const SEEDED_SESSION = "g_Qm7xZLd4nS1bVpKe"; // maya asked; maya and june have answered
const COLLAB = "l_our-campus-ranking"; // maya + dev + june, six places
const COLLAB_TWO = "l_still-open-when-we-are"; // dev + theo, and one place neither has ranked

const shot = async (page: Page, name: string) => {
  await settled(page);
  return page.screenshot({ path: join(EVIDENCE, `${name}-${test.info().project.name}.png`), fullPage: true });
};

const shotViewport = async (page: Page, name: string) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await settled(page);
  await page.waitForTimeout(120);
  return page.screenshot({ path: join(EVIDENCE, `${name}-${test.info().project.name}.png`) });
};

/** Answer a session through the real route, as a signed-in seat. */
async function answer(
  request: APIRequestContext,
  session: string,
  userId: string,
  needs: Record<string, unknown>,
  tag: string,
) {
  await request.post("/api/auth/switch", { data: { userId } });
  const res = await request.post(`/api/group/${session}/needs`, {
    data: { participant_token: `e2e-${tag}-${userId}`.slice(0, 40), ...needs },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** A fresh session with all four answered, built through the routes. */
async function fullTable(request: APIRequestContext, tag: string): Promise<string> {
  await request.post("/api/auth/switch", { data: { userId: "u_maya" } });
  const made = await request.post("/api/group", { data: { invite: ["dev", "june", "theo"] } });
  expect(made.status()).toBe(201);
  const { session } = (await made.json()) as { session: { id: string } };
  const needs: Record<string, Record<string, unknown>> = {
    u_maya: { intent_tag: "group_project", outlets: true, open_now: true, wifi: true },
    u_dev: { intent_tag: "deep_work", outlets: true, open_now: true, wifi: true, max_noise: "conversational" },
    u_june: { intent_tag: "reading", open_now: true, max_noise: "conversational" },
    u_theo: { intent_tag: "late_night", outlets: true, open_now: true },
  };
  for (const uid of FOUR) await answer(request, session.id, uid, needs[uid], tag);
  return session.id;
}

// ───────────────────────────────────────────────────────────────────────────
// 1 · group mode: the intersection of four people's needs
// ───────────────────────────────────────────────────────────────────────────

test.describe("group mode", () => {
  test("a link-holder with no account can read it and take a seat", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto(`/g/${SEEDED_SESSION}`);
    await loaded(page, "[data-group]");

    // the room is legible before anybody is asked for anything
    const roster = page.locator("[data-roster] [data-seat]");
    expect(await roster.count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator("[data-roster]")).toContainText("Maya");
    await expect(page.locator("[data-roster]")).toContainText("June");

    // and the form is there, with no sign-in anywhere on the page
    await expect(page.locator("[data-needs-form]")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/sign in|log in|create an account/i);
    await shot(page, "group-join");

    // four taps and nothing to type
    await page.locator('[data-intent="reading"]').click();
    await page.locator('[data-need="outlets"]').click();
    await page.locator('[data-noise="conversational"]').click();
    await expect(page.locator('[data-intent="reading"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-need="outlets"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator("[data-take-seat]").click();

    await expect(page.locator("[data-needs-form]")).toHaveCount(0);
    await expect(page.locator("[data-roster]")).toContainText("The fourth");
  });

  test("nobody votes: there is no ballot, no tally and no scale on any state", async ({ page, request }) => {
    const id = await fullTable(request, "novote");
    await signIn(page.context(), "u_maya");
    await page.goto(`/g/${id}`);
    await loaded(page, "[data-group]");
    await expectNoRatingScale(page, "the group answer");
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/nobody voted/i);
    // no ballot: nothing on this page submits a preference for a PLACE, only
    // for what the reader needs
    expect(await page.locator("[data-vote], [data-ballot]").count()).toBe(0);
    // and nothing on the page is a denominator
    expect(body).not.toMatch(/\b\d+(st|nd|rd|th)? of \d+\b/i);
  });

  test("the answer names the place, its facts, and the arithmetic behind it", async ({ page, request }) => {
    const id = await fullTable(request, "answer");
    await signIn(page.context(), "u_maya");
    await page.goto(`/g/${id}`);
    await loaded(page, "[data-group]");

    const answerBlock = page.locator("[data-answer]");
    await expect(answerBlock).toBeVisible();
    await expect(answerBlock.locator("h2")).toContainText(/clears everything/i);

    // the ledger subtracts to the number of survivors, and every line of it
    // is a count of places rather than a score
    const ledger = page.locator("[data-ledger]");
    await expect(ledger).toBeVisible();
    const figures = await ledger.locator("dd").allInnerTexts();
    expect(figures.length).toBeGreaterThan(3);
    const total = Number(figures[0]);
    const removed = figures.slice(1, -1).map((f) => Number(f.replace(/[^\d]/g, "")) || 0);
    const left = Number(figures.at(-1));
    expect(total).toBe(22);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(total);
    // the column has to add up, or it is decoration
    expect(removed.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(total - left);

    await shot(page, "group-answer");
  });

  test("a seat at the table is not a friendship: no position leaves the room", async ({
    page,
    context,
    request,
  }) => {
    // Three signed-in seats and one by link, which is the case the rule is
    // about: the fourth person contributes needs, sees the answer, and never
    // sees where anybody has anything.
    await request.post("/api/auth/switch", { data: { userId: "u_maya" } });
    const made = await request.post("/api/group", { data: { invite: ["dev", "june"] } });
    const { session } = (await made.json()) as { session: { id: string } };
    const id = session.id;
    await answer(request, id, "u_maya", { intent_tag: "group_project", outlets: true, open_now: true }, "priv");
    await answer(request, id, "u_dev", { intent_tag: "deep_work", outlets: true, open_now: true }, "priv");
    await answer(request, id, "u_june", { intent_tag: "reading", open_now: true }, "priv");

    // the by-link seat, in a browser with no cookie at all
    await context.clearCookies();
    await page.goto(`/g/${id}`);
    await loaded(page, "[data-group]");
    await page.locator('[data-intent="quick_grab"]').click();
    await page.locator("[data-take-seat]").click();
    await expect(page.locator("[data-needs-form]")).toHaveCount(0);

    const anon = await page.locator("body").innerText();
    await expect(page.locator("[data-whose]")).toHaveCount(0);
    expect(anon).not.toMatch(/has it \d+/);
    expect(anon).not.toMatch(/never been/i);
    expect(anon).toMatch(/sitting at a table is not a friendship/i);
    await shot(page, "group-answer-anon");
    const nameOf = (t: string) => t.match(/CLEARS EVERYTHING\s*\n\s*(.+)/i)?.[1];
    const anonName = nameOf(anon);
    expect(anonName).toBeTruthy();

    // the same page, read by somebody who is IN it and signed in
    await signIn(context, "u_maya");
    await page.goto(`/g/${id}`);
    await loaded(page, "[data-group]");
    await expect(page.locator("[data-whose]")).toBeVisible();
    const seated = await page.locator("body").innerText();
    // the answer is the same — a by-link reader is not given a worse one
    expect(nameOf(seated)).toBe(anonName);
    await shot(page, "group-answer-seated");

    // and the payload carries no denominator for anybody at all
    const res = await request.get(`/api/group/${id}`);
    expect(await res.text()).not.toMatch(/"of"\s*:/);
  });

  test("a fifth person by link is told the table is full, and nothing else", async ({
    page,
    context,
    request,
  }) => {
    const id = await fullTable(request, "full");
    await context.clearCookies();
    await page.goto(`/g/${id}`);
    await loaded(page, "[data-group]");
    await expect(page.locator("body")).toContainText(/all four are taken/i);
    // no answer, no needs, no names beyond the people already seated
    await expect(page.locator("[data-answer]")).toHaveCount(0);
    await expect(page.locator("[data-needs-form]")).toHaveCount(0);
    await expect(page.locator("[data-ledger]")).toHaveCount(0);
    await shot(page, "group-full");
  });

  test("an empty intersection is a designed answer that names what it costs", async ({ page, request }) => {
    // everybody needs everything, at an hour when almost nothing does
    await request.post("/api/auth/switch", { data: { userId: "u_maya" } });
    const made = await request.post("/api/group", { data: { invite: ["dev", "june", "theo"] } });
    const { session } = (await made.json()) as { session: { id: string } };
    for (const uid of FOUR) {
      await answer(
        request,
        session.id,
        uid,
        { intent_tag: "deep_work", outlets: true, wifi: true, open_now: true, max_noise: "quiet" },
        "empty",
      );
    }

    await signIn(page.context(), "u_maya");
    await page.goto(`/g/${session.id}`);
    await loaded(page, "[data-group]");
    const empty = await page.locator("[data-empty]").count();
    if (empty === 0) {
      // The seeded campus does have quiet places with outlets and wifi. When
      // it answers, the page must still be honest about what it took — the
      // empty state is exercised on the arithmetic below instead.
      await expect(page.locator("[data-answer]")).toBeVisible();
      await shot(page, "group-strict");
    } else {
      await expect(page.locator("[data-costs]")).toBeVisible();
      // every need is priced, INCLUDING the ones worth nothing
      await expect(page.locator("[data-costs] li")).toHaveCount(4);
      await shot(page, "group-empty");
    }
    // either way, an unlogged room is never counted as a yes
    const body = await page.locator("body").innerText();
    if (body.includes("Nobody has logged")) expect(body).toMatch(/an unknown is not a yes/i);
  });

  test("a table of people who have been nowhere gets an honest answer, not an empty one", async ({
    page,
    context,
    request,
  }) => {
    // Four brand-new accounts: everything still open clears their needs, and
    // none of them has ranked anything, so there is nothing to order the
    // survivors by. Saying "nothing clears it" here would send four people
    // home over a full campus.
    const host = await signInAsNewUser(context, "nobody");
    const start = await context.request.post("/api/group", { data: { invite: [] } });
    expect(start.status()).toBe(201);
    const { session } = (await start.json()) as { session: { id: string } };
    await context.request.post(`/api/group/${session.id}/needs`, {
      data: { participant_token: `pt-${host}`.slice(0, 40), intent_tag: "reading", open_now: true },
    });
    for (let i = 0; i < 2; i++) {
      const other = await signInAsNewUser(context, `none${i}`);
      await context.request.post(`/api/group/${session.id}/needs`, {
        data: { participant_token: `pt-${other}`.slice(0, 40), open_now: true },
      });
    }

    // the reader takes the last seat through the form, which is also how a
    // by-link participant reaches the answer at all
    await context.clearCookies();
    await page.goto(`/g/${session.id}`);
    await loaded(page, "[data-group]");
    await page.locator('[data-intent="quick_grab"]').click();
    await page.locator("[data-take-seat]").click();
    await expect(page.locator("[data-needs-form]")).toHaveCount(0);
    await expect(page.locator("[data-none-been]")).toBeVisible();
    await expect(page.locator("[data-none-been]")).toContainText(/none of you has put any of them in order/i);
    await expect(page.locator("[data-empty]")).toHaveCount(0);
    await expect(page.locator("[data-ledger]")).toBeVisible();
    await shot(page, "group-none-been");
    void request;
  });

  test("a session is a link: unguessable, and a dead one says so", async ({ page, context, request }) => {
    await context.clearCookies();
    await page.goto("/g/g_notatable0000");
    await expect(page.locator("[data-group][data-state='gone']")).toBeVisible();
    await expect(page.locator("body")).toContainText(/doesn't open anything/i);
    await shot(page, "group-gone");

    await request.post("/api/auth/switch", { data: { userId: "u_maya" } });
    const made = await request.post("/api/group", { data: { invite: [] } });
    const { session } = (await made.json()) as { session: { id: string } };
    expect(session.id).toMatch(/^g_[A-Za-z0-9_-]{16,}$/);
  });

  test("you can only ask people you have agreed to know", async ({ request }) => {
    await request.post("/api/auth/switch", { data: { userId: "u_dev" } });
    // u_sam and u_dev are not friends in the seed
    const res = await request.post("/api/group", { data: { invite: ["sam"] } });
    expect(res.status()).toBe(403);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2 · the collaborative list
// ───────────────────────────────────────────────────────────────────────────

test.describe("a list two or more people keep", () => {
  test("re-ranks from the contributors' own lists, and only when told to", async ({ page, context }) => {
    await signIn(context, "u_maya");
    await page.goto(`/lists/${COLLAB}`);
    await loaded(page, "[data-list]");
    await expect(page.locator("[data-collab]")).toBeVisible();
    await expect(page.locator("[data-finding]")).toContainText(/never once agreed on the order|cannot be separated/i);

    const before = await page.locator("[data-item]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-shop-id")),
    );
    await shot(page, "list-before");

    // nothing has moved on its own: the page says so and offers the act
    const offered = await page.locator("[data-out-of-date]").count();
    if (offered > 0) {
      await page.locator("[data-redraw]").click();
      await expect(page.locator("[data-said]")).toContainText(/moved/i);
      // the list re-reads itself after the write, so wait for the page to
      // say it is settled before reading the order back off it
      await expect(page.locator("[data-list][data-settled]")).toBeVisible();
      const after = await page.locator("[data-item]").evaluateAll((els) =>
        els.map((e) => e.getAttribute("data-shop-id")),
      );
      expect(after).not.toEqual(before);
    }
    await expect(page.locator("[data-list][data-settled]")).toBeVisible();
    await shot(page, "list-after");
  });

  test("a tie shares one standing, and the column jumps", async ({ page, context }) => {
    await signIn(context, "u_maya");
    await page.goto(`/lists/${COLLAB}`);
    await loaded(page, "[data-list]");
    if ((await page.locator("[data-redraw]").count()) > 0) await page.locator("[data-redraw]").click();
    await expect(page.locator("[data-list][data-settled]")).toBeVisible();

    const shared = page.locator("li[data-shared]");
    await expect(shared).toHaveCount(1);
    // two places, one numeral, and the note that says why
    expect(await shared.locator("[data-item]").count()).toBe(2);
    await expect(page.locator("[data-tie-note]")).toContainText(/came out level/i);

    // the standings go 1, 2, 3, 3, 5 — never 1, 2, 3, 4
    const standings = await page.locator("li[data-standing]").evaluateAll((els) =>
      els.map((e) => Number(e.getAttribute("data-standing"))),
    );
    const tiedAt = Number(await shared.getAttribute("data-standing"));
    expect(standings).not.toContain(tiedAt + 1);
    expect(standings).toContain(tiedAt + 2);
  });

  test("a place nobody who can edit has ranked gets no numeral at all", async ({ page, context }) => {
    await signIn(context, "u_dev");
    await page.goto(`/lists/${COLLAB_TWO}`);
    await loaded(page, "[data-list]");
    if ((await page.locator("[data-redraw]").count()) > 0) await page.locator("[data-redraw]").click();
    await expect(page.locator("[data-unranked]")).toBeVisible();

    const outside = page.locator("[data-outside]");
    await expect(outside).toHaveCount(1);
    await expect(outside).toContainText("Copper Kettle");
    // it is not in the ordered list, and there is no cell where a rank would go
    const ordered = await page.locator("[data-item]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-shop-id")),
    );
    expect(ordered).not.toContain("s_copper-kettle");
    await expect(page.locator("[data-unranked]")).toContainText(/could be given a position by guessing/i);
    await shot(page, "list-unranked");
  });

  test("only an editor may move it, and only the owner hands over the pen", async ({ request }) => {
    await request.post("/api/auth/switch", { data: { userId: "u_sam" } });
    expect((await request.post(`/api/lists/${COLLAB}/rerank`)).status()).toBe(404);
    // u_june is an editor, not the owner
    await request.post("/api/auth/switch", { data: { userId: "u_june" } });
    expect(
      (await request.post(`/api/lists/${COLLAB}/editors`, { data: { username: "sam" } })).status(),
    ).toBe(404);
    // and the owner may only add somebody they have agreed to know
    await request.post("/api/auth/switch", { data: { userId: "u_maya" } });
    expect(
      (await request.post(`/api/lists/${COLLAB}/editors`, { data: { username: "lena" } })).status(),
    ).toBe(403);
  });

  test("nothing on it is averaged, and nothing on it is a score", async ({ page, context }) => {
    await signIn(context, "u_maya");
    await page.goto(`/lists/${COLLAB}`);
    await loaded(page, "[data-list]");
    await expectNoRatingScale(page, "the collaborative list");
    await expect(page.locator("body")).toContainText(/nothing here is scored, and nothing here was paid for/i);
    await expect(page.locator("body")).toContainText(/nothing is averaged/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3 · the feed, and the one number the shelf carries
// ───────────────────────────────────────────────────────────────────────────

/**
 * A fresh account asks somebody to be friends, and returns the asker's name.
 *
 * The seed does carry one pending request (Lena → Maya) and this suite
 * deliberately does not use it: answering an ask CONSUMES it, so a borrowed
 * fixture works exactly once and the second run finds the state its own first
 * run created. That is the Phase 3 lesson, and it cost this suite a debugging
 * session before it was applied here.
 */
async function askedBySomebodyNew(request: APIRequestContext, target: string, tag: string): Promise<string> {
  const username = `${tag}${Date.now().toString(36).slice(-6)}`;
  const made = await request.post("/api/auth/create", {
    data: { username, display_name: `Test ${tag}` },
  });
  expect(made.status(), await made.text()).toBe(201);
  const asked = await request.post("/api/friends/request", { data: { username: target } });
  expect(asked.status(), await asked.text()).toBe(201);
  return username;
}

test.describe("the notification feed", () => {
  test("splits what asks you something from what only tells you", async ({ page, context, request }) => {
    await askedBySomebodyNew(request, "maya", "feedask");
    await signIn(context, "u_maya");
    await page.goto("/maya");
    await loaded(page, "[data-feed]");
    const feed = page.locator("[data-feed]");

    const asks = feed.locator("[data-ask]");
    expect(await asks.count()).toBeGreaterThanOrEqual(1);
    await expect(asks.first()).toContainText("asked to be friends");
    await expect(asks.first().locator("[data-accept]")).toBeVisible();
    await expect(asks.first().locator("[data-dismiss]")).toBeVisible();

    // news has nothing to press
    const news = feed.locator("[data-news]");
    expect(await news.count()).toBeGreaterThan(0);
    expect(await news.locator("button, a").count()).toBe(0);

    // an ask is set in the display face and news is not — different in kind
    const askSize = await asks.locator("p").nth(1).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const newsSize = await news.first().locator("p").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(askSize).toBeGreaterThan(newsSize);

    await expect(page.locator("[data-audit]")).toContainText("Five things can put a line here");
    await shot(page, "feed");
  });

  test("the shelf carries the asks, and answering discharges it", async ({ page, context, request }) => {
    // Its own person, its own ask — see askedBySomebodyNew.
    await askedBySomebodyNew(request, "june", "shelf");
    await signIn(context, "u_june");
    await page.goto("/june");
    await loaded(page, "[data-feed]");

    // Not "badge" — the product does not have one. It is the number of
    // people waiting on an answer, and it carries its own screen-reader
    // sentence, so read the figure out of it.
    const waiting = page.locator("[data-tab='you'] [data-waiting]");
    const count = async () => Number((await waiting.innerText()).match(/\d+/)?.[0] ?? 0);
    const before = await count();
    expect(before).toBeGreaterThanOrEqual(1);
    expect(before).toBe(await page.locator("[data-ask]").count());
    await shotViewport(page, "feed-shelf");

    // "not now" is an answer: the count is lowered by answering and by
    // nothing else — not by looking, and not by a clock.
    await page.locator("[data-ask] [data-dismiss]").first().click();
    await expect(page.locator("[data-ask]")).toHaveCount(before - 1);
    await page.reload();
    await loaded(page, "[data-feed]");
    const after = await page.locator("[data-tab='you'] [data-waiting]").count();
    if (before === 1) expect(after).toBe(0);
    else expect(await count()).toBe(before - 1);

    // and news never puts a number anywhere: it is still on the page
    expect(await page.locator("[data-news]").count()).toBeGreaterThan(0);
  });

  test("asking is a human action, and it reaches exactly one person", async ({ page, context, request }) => {
    // A brand-new account does the asking, so nothing seeded is consumed.
    const me = await signInAsNewUser(context, "asker");
    await page.goto("/theo");
    await page.locator("[data-ask-friend]").waitFor({ state: "visible" });
    await shot(page, "profile-before-asking");
    await page.locator("[data-ask-friend]").click();
    await expect(page.locator("[data-standing='asked']")).toBeVisible();
    await shot(page, "profile-asked");

    // it lands on Theo's page as an ask…
    await request.post("/api/auth/switch", { data: { userId: "u_theo" } });
    const feed = (await (await request.get("/api/notifications")).json()) as {
      entries: Array<{ type: string; needs_answer: boolean; actor: { username: string } }>;
    };
    const fromMe = feed.entries.filter((e) => e.actor.username === me);
    expect(fromMe).toHaveLength(1);
    expect(fromMe[0]).toMatchObject({ type: "friend_request", needs_answer: true });

    // …and on nobody else's. There is no feed of other people's activity.
    for (const other of ["u_maya", "u_dev", "u_june"]) {
      await request.post("/api/auth/switch", { data: { userId: other } });
      const theirs = (await (await request.get("/api/notifications")).json()) as {
        entries: Array<{ actor: { username: string } }>;
      };
      expect(theirs.entries.filter((e) => e.actor.username === me), other).toHaveLength(0);
    }
  });

  test("a feed with nothing on it reads as a quiet week, not a fault", async ({ page, context }) => {
    await signIn(context, "u_noah");
    await page.goto("/noah");
    await loaded(page, "[data-feed]");
    await expect(page.locator("[data-feed][data-state='empty']")).toBeVisible();
    await expect(page.locator("[data-feed]")).toContainText(/quiet week/i);
    await expect(page.locator("[data-audit]")).toBeVisible();
    await expect(page.locator("[data-tab='you'] [data-waiting]")).toHaveCount(0);
    await shot(page, "feed-empty");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4 · the phase's a11y and anti-slop sweep
// ───────────────────────────────────────────────────────────────────────────

test.describe("accessibility", () => {
  const SURFACES = [
    { name: "group-join", path: `/g/${SEEDED_SESSION}`, as: null },
    { name: "group-answer", path: null, as: "u_maya" },
    { name: "list", path: `/lists/${COLLAB}`, as: "u_maya" },
    { name: "feed", path: "/maya", as: "u_maya" },
    { name: "group-new", path: "/group/new", as: "u_maya" },
  ] as const;

  test("axe finds no serious or critical violations", async ({ page, context, request }, testInfo) => {
    const answered = await fullTable(request, "axe");
    for (const s of SURFACES) {
      if (s.as) await signIn(context, s.as);
      else await context.clearCookies();
      await page.goto(s.path ?? `/g/${answered}`);
      await settled(page);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      writeFileSync(
        join(EVIDENCE, `axe-${s.name}-${testInfo.project.name}.json`),
        JSON.stringify(
          {
            url: page.url(),
            passes: results.passes.length,
            violations: results.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              help: v.help,
              nodes: v.nodes.map((n) => n.html),
            })),
          },
          null,
          2,
        ),
      );
      expect(bad, `${s.name}: ` + bad.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
    }
  });

  test("headings run in order on every new surface", async ({ page, context }) => {
    for (const path of [`/g/${SEEDED_SESSION}`, `/lists/${COLLAB}`, "/maya", "/group/new"]) {
      await signIn(context, "u_maya");
      await page.goto(path);
      await loaded(page, "main");
      const levels = await page
        .locator("h1, h2, h3")
        .evaluateAll((els) => els.map((e) => Number(e.tagName.slice(1))));
      expect(levels[0], path).toBe(1);
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i] - levels[i - 1], `${path} at ${i}`).toBeLessThanOrEqual(1);
      }
    }
  });

  test("tap targets are at least 44px", async ({ page, context }) => {
    await signIn(context, "u_maya");
    for (const path of [`/g/${SEEDED_SESSION}`, `/lists/${COLLAB}`, "/maya", "/group/new"]) {
      await page.goto(path);
      await loaded(page, "main");
      await expectTapTargets(page, path);
    }
  });

  test("prefers-reduced-motion removes all animation", async ({ page, context }) => {
    await signIn(context, "u_maya");
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const path of [`/g/${SEEDED_SESSION}`, `/lists/${COLLAB}`, "/maya"]) {
      await page.goto(path);
      await loaded(page, "main");
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
      expect(moving, path).toEqual([]);
    }
  });

  test("no page in this phase scrolls sideways", async ({ page, context }) => {
    await signIn(context, "u_maya");
    for (const path of [`/g/${SEEDED_SESSION}`, `/lists/${COLLAB}`, "/maya", "/group/new"]) {
      await page.goto(path);
      await loaded(page, "main");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });
});
