// Phase 3 acceptance: the log flow and the head-to-head that follows it.
//
//   COSIGN_DB=/tmp/e2e.db npm run seed         # a scratch database
//   COSIGN_DB=/tmp/e2e.db npm run serve:prod   # in another shell
//   COSIGN_EVIDENCE=phase3 npx playwright test log.spec.ts
//
// These tests WRITE (that is the point — the flow's whole job is to write),
// so they run against a scratch DB rather than server/data/cosign.db. Run
// them against the real one twice and the second run finds u_noah already
// has a ranking.
//
// The contract with the UI is a set of data-* hooks, so the assertions
// survive a visual redesign but not a missing requirement.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EVIDENCE,
  USERS,
  expectNoRatingScale,
  expectTapTargets,
  settled,
  shot,
  signIn,
  signInAsNewUser,
} from "./fixtures";

const INTENT = "deep_work";

/** A tap is a tap: this counts every one, including the entry and the save. */
class Taps {
  n = 0;
  async tap(page: Page, selector: string) {
    this.n++;
    await page.locator(selector).first().click();
  }
}

/**
 * A fresh account with a small ranking, built through the real insert route.
 * The head/middle/tail tests each add a place permanently, so borrowing a
 * seeded account means the suite's own re-runs slowly eat the unranked
 * shops out from under it.
 */
async function newUserWithRanking(page: Page, context: BrowserContext, tag: string, n = 5): Promise<string[]> {
  await signInAsNewUser(context, tag);
  const { shops } = (await (await page.request.get("/api/shops")).json()) as { shops: Array<{ id: string }> };
  const picks = shops.slice(0, n).map((s) => s.id);
  for (let i = 0; i < picks.length; i++) {
    const res = await page.request.post("/api/rankings/insert", {
      data: { shop_id: picks[i], position: i + 1, comparisons: [] },
    });
    expect(res.status(), await res.text()).toBe(201);
  }
  return picks;
}

/**
 * No step may spend a tap on navigation. Checked ON each step rather than
 * once at the end: a Next button on step 3 is invisible to a post-save
 * snapshot, and an anchored /^next$/ would miss "Next question".
 */
async function expectNoNavigationTap(page: Page, step: string) {
  const nav = await page
    .locator("[data-logflow], [data-placeflow]")
    .getByRole("button", { name: /next|continue|submit|done/i })
    .count();
  expect(nav, `a navigation tap on ${step}`).toBe(0);
}

async function rankingOf(page: Page): Promise<string[]> {
  const res = await page.request.get("/api/rankings/me");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { entries: Array<{ shop_id: string }> };
  return body.entries.map((e) => e.shop_id);
}

/** Walk the four asks, leaving the flow on the review step. */
async function walkToReview(page: Page, taps: Taps, opts: { fromShop?: string } = {}) {
  if (opts.fromShop) {
    await page.goto(`/log?shop=${opts.fromShop}`);
  } else {
    await page.goto("/");
    await taps.tap(page, "[data-log-entry]");
    await expect(page.locator('[data-logflow][data-step="where"]')).toBeVisible();
    await taps.tap(page, "[data-place-row]");
  }
  await expect(page.locator('[data-logflow][data-step="why"]')).toBeVisible();
  await taps.tap(page, `[data-option][data-value="${INTENT}"]`);
  await expect(page.locator('[data-logflow][data-step="noise"]')).toBeVisible();
  await taps.tap(page, '[data-option][data-value="quiet"]');
  await expect(page.locator('[data-logflow][data-step="crowd"]')).toBeVisible();
  await taps.tap(page, '[data-option][data-value="comfortable"]');
  await expect(page.locator('[data-logflow][data-step="review"]')).toBeVisible();
}

test.describe("the log flow", () => {
  test("saves a visit in six taps, with no keyboard and one decision per step", async ({ page, context }, testInfo) => {
    await signInAsNewUser(context, "taps");
    const project = testInfo.project.name;
    const taps = new Taps();

    await page.goto("/");
    await taps.tap(page, "[data-log-entry]");

    // ── step 1: where ──
    await expect(page.locator('[data-logflow][data-step="where"]')).toBeVisible();
    await expectNoNavigationTap(page, "where");
    expect(await page.locator("[data-place-row]").count()).toBeGreaterThanOrEqual(20);
    expect(await page.locator("[data-save]").count()).toBe(0); // nothing writes yet
    await shot(page, "step-1-where", project);
    await taps.tap(page, "[data-place-row]");

    // ── step 2: why — all nine canonical intents, in canonical order ──
    await expect(page.locator('[data-logflow][data-step="why"]')).toBeVisible();
    await expectNoNavigationTap(page, "why");
    await expect(page.locator("[data-option]")).toHaveCount(9);
    await shot(page, "step-2-why", project);
    await taps.tap(page, `[data-option][data-value="${INTENT}"]`);

    // ── step 3: noise — a labeled enum, never a scale ──
    await expect(page.locator('[data-logflow][data-step="noise"]')).toBeVisible();
    await expectNoNavigationTap(page, "noise");
    await expect(page.locator("[data-option]")).toHaveCount(3);
    await expect(page.locator("[data-skip]")).toHaveCount(1);
    await shot(page, "step-3-noise", project);
    await taps.tap(page, '[data-option][data-value="quiet"]');

    // ── step 4: crowd ──
    await expect(page.locator('[data-logflow][data-step="crowd"]')).toBeVisible();
    await expectNoNavigationTap(page, "crowd");
    await expect(page.locator("[data-option]")).toHaveCount(3);
    await shot(page, "step-4-crowd", project);
    await taps.tap(page, '[data-option][data-value="comfortable"]');

    // ── step 5: review — at most two optional confirmations, then commit ──
    await expect(page.locator('[data-logflow][data-step="review"]')).toBeVisible();
    expect(await page.locator("[data-confirm]").count()).toBeLessThanOrEqual(2);
    await shot(page, "step-5-review", project);

    const saved = page.waitForResponse((r) => r.url().includes("/api/logs") && r.request().method() === "POST");
    await taps.tap(page, "[data-save]");
    expect((await saved).status()).toBe(201);

    // Six taps: entry, place, intent, noise, crowd, save.
    expect(taps.n, "taps from cold to a saved log").toBe(6);


    await expect(page.locator("[data-placeflow]")).toBeVisible();
    await shot(page, "step-6-stamp", project);
    writeFileSync(join(EVIDENCE, `taps-${project}.json`), JSON.stringify({ required_taps: taps.n, cap: 8 }, null, 2));
  });

  test("asks for no keyboard input and shows no rating scale on any step", async ({ page, context }) => {
    await signInAsNewUser(context, "kbd");
    await page.goto("/");
    await page.locator("[data-log-entry]").click();

    for (const [step, next] of [
      ["where", "[data-place-row]"],
      ["why", `[data-option][data-value="${INTENT}"]`],
      ["noise", '[data-option][data-value="loud"]'],
      ["crowd", '[data-option][data-value="packed"]'],
    ] as const) {
      await expect(page.locator(`[data-logflow][data-step="${step}"]`)).toBeVisible();
      expect(await page.locator("input:visible, textarea:visible").count(), `keyboard on ${step}`).toBe(0);
      await expectNoRatingScale(page, `log step ${step}`);
      await page.locator(next).first().click();
    }

    await expect(page.locator('[data-logflow][data-step="review"]')).toBeVisible();
    expect(await page.locator("input:visible, textarea:visible").count(), "keyboard on review").toBe(0);
    await expectNoRatingScale(page, "log step review");

    // The only keyboard in the flow is the optional line, one deliberate tap
    // off the path and skippable by never touching it.
    await page.locator("[data-extras-open]").click();
    await expect(page.locator('[data-logflow][data-step="extras"]')).toBeVisible();
    await expectNoRatingScale(page, "log step extras");
    await expect(page.locator("[data-line-input]")).toBeVisible();
  });

  test("a deep link lands on the first unanswered question, never a broken screen", async ({ page, context }) => {
    await signIn(context, USERS.lena);
    const shops = (await (await page.request.get("/api/shops")).json()) as { shops: Array<{ slug: string }> };
    const slug = shops.shops[0].slug;

    // The place is known, so the intent question is reachable directly.
    await page.goto(`/log?shop=${slug}&step=why`);
    await expect(page.locator('[data-logflow][data-step="why"]')).toBeVisible();
    await expect(page.locator("[data-option]")).toHaveCount(9);

    // The intent is not, so a link past it falls back rather than saving a
    // log with a hole in it.
    await page.goto(`/log?shop=${slug}&step=review`);
    await expect(page.locator('[data-logflow][data-step="why"]')).toBeVisible();
    await page.goto("/log?step=review");
    await expect(page.locator('[data-logflow][data-step="where"]')).toBeVisible();
    await page.goto("/log?shop=not-a-real-place");
    await expect(page.locator('[data-logflow][data-step="where"]')).toBeVisible();
  });

  test("stamps time_bucket and semester server-side and never asks for them", async ({ page, context }) => {
    await signInAsNewUser(context, "stamp");
    const taps = new Taps();
    const saved = page.waitForResponse((r) => r.url().includes("/api/logs") && r.request().method() === "POST");
    await walkToReview(page, taps);

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/what time|time of day|which semester|what term/i);

    await page.locator("[data-save]").click();
    const log = (await (await saved).json()) as { log: { time_bucket: string; semester: string } };
    expect(["morning", "afternoon", "evening", "late_night"]).toContain(log.log.time_bucket);
    expect(log.log.semester).toBeTruthy();

    const receipt = page.locator("[data-placeflow] [data-receipt]");
    await expect(receipt).toHaveAttribute("data-time-bucket", log.log.time_bucket);
    await expect(receipt).toHaveAttribute("data-semester", log.log.semester);
  });

  test("saves the log before any ranking work starts", async ({ page, context }) => {
    await signIn(context, USERS.lena);
    const order: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "POST") return;
      if (r.url().includes("/api/logs")) order.push("log");
      if (r.url().includes("/api/rankings/insert")) order.push("insert");
    });

    const ranked = await rankingOf(page);
    const taps = new Taps();
    await page.goto("/");
    await taps.tap(page, "[data-log-entry]");
    // an unranked place, so a head-to-head really does follow the save
    const candidate = await pickUnranked(page, ranked);
    await page.locator(`[data-place-row][data-shop-id="${candidate.id}"]`).click();
    await expect(page.locator('[data-logflow][data-step="why"]')).toBeVisible();

    await page.locator(`[data-option][data-value="${INTENT}"]`).click();
    await page.locator('[data-option][data-value="quiet"]').click();
    await page.locator('[data-option][data-value="comfortable"]').click();

    expect(await page.locator("[data-placeflow]").count(), "no ranking screen before the save").toBe(0);
    const saved = page.waitForResponse((r) => r.url().includes("/api/logs") && r.request().method() === "POST");
    await page.locator("[data-save]").click();
    expect((await saved).status()).toBe(201);
    await expect(page.locator("[data-placeflow]")).toBeVisible();

    expect(order[0]).toBe("log");
    expect(order.filter((x) => x === "log")).toHaveLength(1);
  });
});

test.describe("the head-to-head", () => {
  for (const branch of ["head", "middle", "tail"] as const) {
    test(`places a new visit at the ${branch} of the list`, async ({ page, context }, testInfo) => {
      const order = await newUserWithRanking(page, context, `h2h${branch}`);
      expect(order, "the fixture ranking is built through the real insert route").toEqual(await rankingOf(page));
      const candidate = await pickUnranked(page, order);

      const taps = new Taps();
      await walkToReview(page, taps, { fromShop: candidate.slug });
      await page.locator("[data-save]").click();
      await expect(page.locator('[data-placeflow][data-phase="compare"]')).toBeVisible();

      // Drive the search and check every opponent against the midpoint the
      // binary search must ask for, rather than against a memorised list.
      let lo = 0;
      let hi = order.length;
      let asked = 0;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        await expect(page.locator('[data-side="opponent"]')).toHaveAttribute("data-shop-id", order[mid]);
        if (asked === 0) await shot(page, `compare-1-${branch}`, testInfo.project.name);
        const candidateWins = branch === "head" || (branch === "middle" && asked % 2 === 1);
        await page.locator(candidateWins ? '[data-side="candidate"]' : '[data-side="opponent"]').click();
        if (candidateWins) hi = mid;
        else lo = mid + 1;
        asked++;
      }
      expect(asked, "comparisons stay inside ceil(log2(n+1))").toBeLessThanOrEqual(
        Math.ceil(Math.log2(order.length + 1)),
      );

      await expect(page.locator('[data-placeflow][data-phase="done"]')).toBeVisible();
      await expect(page.locator('[data-done="placed"]')).toBeVisible();
      await expect(page.locator("[data-final-position]")).toHaveText(String(lo + 1));
      if (branch === "head") await expect(page.locator("[data-final-position]")).toHaveText("1");
      if (branch === "tail") await expect(page.locator("[data-final-position]")).toHaveText(String(order.length + 1));

      const after = await rankingOf(page);
      expect(after.indexOf(candidate.id)).toBe(lo);
      expect(after).toHaveLength(order.length + 1);
      await shot(page, `done-placed-${branch}`, testInfo.project.name);
      await expectNoRatingScale(page, `head-to-head ${branch}`);
    });
  }

  test("an empty list needs no comparison at all", async ({ page, context }, testInfo) => {
    await signInAsNewUser(context, "empty");
    expect(await rankingOf(page), "a fresh account starts with no ranking").toHaveLength(0);

    const inserts: Array<{ position: number; comparisons: unknown[] }> = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/rankings/insert") && r.method() === "POST") {
        inserts.push(r.postDataJSON());
      }
    });

    const taps = new Taps();
    await walkToReview(page, taps);
    await page.locator("[data-save]").click();
    await expect(page.locator('[data-done="first"]')).toBeVisible();
    expect(await page.locator('[data-side="opponent"]').count()).toBe(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].position).toBe(1);
    expect(inserts[0].comparisons).toEqual([]);
    await shot(page, "done-first", testInfo.project.name);
  });

  test("a place already in the list is not asked about again", async ({ page, context }, testInfo) => {
    await signIn(context, USERS.lena);
    const order = await rankingOf(page);
    const already = order[1];
    const inserts: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/rankings/insert") && r.method() === "POST") inserts.push(r.url());
    });

    const shops = await (await page.request.get("/api/shops")).json();
    const slug = shops.shops.find((s: { id: string }) => s.id === already).slug;
    const taps = new Taps();
    await walkToReview(page, taps, { fromShop: slug });
    await page.locator("[data-save]").click();

    await expect(page.locator('[data-done="already"]')).toBeVisible();
    expect(inserts, "an existing entry is never silently re-inserted").toEqual([]);
    await shot(page, "done-already", testInfo.project.name);
  });

  test("leaving mid-ranking keeps the log and offers it back", async ({ page, context }, testInfo) => {
    await signIn(context, USERS.lena);
    const order = await rankingOf(page);
    const candidate = await pickUnranked(page, order);
    const inserts: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/rankings/insert") && r.method() === "POST") inserts.push(r.url());
    });

    const taps = new Taps();
    await walkToReview(page, taps, { fromShop: candidate.slug });
    await page.locator("[data-save]").click();
    await expect(page.locator('[data-placeflow][data-phase="compare"]')).toBeVisible();
    await page.locator("[data-later]").click();

    await expect(page.locator('[data-done="unranked"]')).toBeVisible();
    expect(inserts, "abandoning writes nothing to the ranking").toEqual([]);
    expect(await rankingOf(page), "the list is untouched").toHaveLength(order.length);
    await shot(page, "done-unranked", testInfo.project.name);

    // The log survived, and /rank offers the head-to-head back.
    await page.goto("/rank");
    await expect(page.locator(`[data-rank-it][data-shop-id="${candidate.id}"]`)).toBeVisible();
    await shot(page, "rank-not-ranked-yet", testInfo.project.name);
  });

  test("a tap can be taken back before anything is written", async ({ page, context }) => {
    await signIn(context, USERS.dev);
    const order = await rankingOf(page);
    const candidate = await pickUnranked(page, order);
    const taps = new Taps();
    await walkToReview(page, taps, { fromShop: candidate.slug });
    await page.locator("[data-save]").click();
    await expect(page.locator('[data-placeflow][data-phase="compare"]')).toBeVisible();

    const first = await page.locator('[data-side="opponent"]').getAttribute("data-shop-id");
    await page.locator('[data-side="candidate"]').click();
    const second = await page.locator('[data-side="opponent"]').getAttribute("data-shop-id");
    expect(second).not.toBe(first);
    await page.locator("[data-untap]").click();
    await expect(page.locator('[data-side="opponent"]')).toHaveAttribute("data-shop-id", first!);
  });
});

test.describe("the flow's quality gates", () => {
  test("axe finds no serious or critical violations on any step", async ({ page, context }, testInfo) => {
    await signIn(context, USERS.lena);
    const results: Record<string, number> = {};
    // Deliberately an UNRANKED place: picking the first row gives whatever is
    // closest, which is usually already in lena's list — and the audit would
    // then land on the "already ranked" done screen and never see the
    // head-to-head at all.
    const candidate = await pickUnranked(page, await rankingOf(page));
    await page.goto("/");
    await page.locator("[data-log-entry]").click();

    const steps: Array<[string, string]> = [
      ["where", `[data-place-row][data-shop-id="${candidate.id}"]`],
      ["why", `[data-option][data-value="${INTENT}"]`],
      ["noise", '[data-option][data-value="quiet"]'],
      ["crowd", '[data-option][data-value="comfortable"]'],
      ["review", "[data-save]"],
    ];
    for (const [step, next] of steps) {
      await expect(page.locator(`[data-logflow][data-step="${step}"]`)).toBeVisible();
      results[step] = await auditStep(page, `log-${step}`, testInfo.project.name);
      await page.locator(next).first().click();
    }

    // The comparison screen, which is a different surface from the result.
    await expect(page.locator('[data-placeflow][data-phase="compare"]')).toBeVisible();
    results.compare = await auditStep(page, "placeflow-compare", testInfo.project.name);
    await expectTapTargets(page, "head-to-head");
    while (await page.locator('[data-side="candidate"]').count()) {
      await page.locator('[data-side="candidate"]').click();
    }
    await expect(page.locator('[data-placeflow][data-phase="done"]')).toBeVisible();
    results.done = await auditStep(page, "placeflow-done", testInfo.project.name);
    expect(Object.values(results).every((v) => v === 0)).toBe(true);
  });

  test("a tapped confirmation is stored, and only while it is offered", async ({ page, context }) => {
    await signIn(context, USERS.lena);
    const taps = new Taps();
    await walkToReview(page, taps); // crowd = comfortable, so a table is news
    const confirms = page.locator("[data-confirm]");
    expect(await confirms.count()).toBeGreaterThan(0);
    const key = await confirms.first().getAttribute("data-tap-key");
    await confirms.first().click();
    await expect(confirms.first()).toHaveAttribute("aria-pressed", "true");

    const saved = page.waitForResponse((r) => r.url().includes("/api/logs") && r.request().method() === "POST");
    await page.locator("[data-save]").click();
    const { log } = (await (await saved).json()) as { log: { taps: Record<string, boolean> } };
    expect(log.taps[key!]).toBe(true);
    // Confirmations are booleans about the visit, never a count or a score.
    expect(Object.values(log.taps).every((v) => v === true)).toBe(true);
  });

  test("every target on the flow clears 44px", async ({ page, context }) => {
    await signIn(context, USERS.lena);
    await page.goto("/log");
    await expectTapTargets(page, "where");
    await page.locator("[data-place-row]").first().click();
    await expectTapTargets(page, "why");
    await page.locator(`[data-option][data-value="${INTENT}"]`).click();
    await expectTapTargets(page, "noise");
  });

  test("prefers-reduced-motion removes all animation", async ({ page, context }, testInfo) => {
    await signIn(context, USERS.lena);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const taps = new Taps();
    await walkToReview(page, taps);
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
    await shot(page, "reduced-motion-review", testInfo.project.name);
  });

  test("the optional photo is captured locally and never leaves the machine", async ({ page, context }, testInfo) => {
    await signIn(context, USERS.lena);
    const external: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (!["localhost", "127.0.0.1"].includes(url.hostname)) external.push(r.url());
    });

    const taps = new Taps();
    await walkToReview(page, taps);
    await page.locator("[data-extras-open]").click();
    await page.locator("[data-line-input]").fill("The window seat is the whole point.");
    await page.locator("[data-photo-input]").setInputFiles({
      name: "visit.png",
      mimeType: "image/png",
      buffer: onePixelPng(),
    });
    const uploaded = await page.waitForResponse((r) => r.url().includes("/api/uploads"));
    expect(uploaded.status()).toBe(201);
    await shot(page, "step-5b-extras", testInfo.project.name);

    const saved = page.waitForResponse((r) => r.url().includes("/api/logs") && r.request().method() === "POST");
    await page.locator("[data-save]").click();
    const { log } = (await (await saved).json()) as { log: { photo: string; line: string } };
    expect(log.photo).toMatch(/^\/u\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/);
    expect(log.line).toBe("The window seat is the whole point.");
    expect(external, "zero external services").toEqual([]);
  });
});

test.describe("the ten second budget", () => {
  test("a log is saved inside ten seconds on a throttled phone", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the budget is a phone budget");
    test.setTimeout(180_000);
    await signInAsNewUser(context, "timed");

    const client = await context.newCDPSession(page);
    await client.send("Network.enable");
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });

    const runs: number[] = [];
    for (let i = 0; i < 3; i++) {
      await page.goto("/");
      await page.locator("[data-log-entry]").waitFor();
      const started = Date.now();
      await page.locator("[data-log-entry]").click();
      await page.locator("[data-place-row]").first().click();
      await page.locator(`[data-option][data-value="${INTENT}"]`).click();
      await page.locator('[data-option][data-value="quiet"]').click();
      await page.locator('[data-option][data-value="comfortable"]').click();
      await page.locator("[data-save]").click();
      await page.locator("[data-placeflow]").waitFor();
      runs.push(Date.now() - started);
      // bounded: on the first run the list is empty, so there is no
      // comparison screen to leave and no reason to wait 30 s finding out
      await page.locator("[data-later]").click({ timeout: 2_000 }).catch(() => {});
    }

    const median = [...runs].sort((a, b) => a - b)[1];
    writeFileSync(
      join(EVIDENCE, "timing.json"),
      JSON.stringify(
        { runs_ms: runs, median_ms: median, budget_ms: 10_000, cpu_throttle: "4x", network: "slow-4g" },
        null,
        2,
      ),
    );
    expect(median, `runs: ${runs.join(", ")} ms`).toBeLessThanOrEqual(10_000);
  });
});

async function pickUnranked(page: Page, ranked: string[]): Promise<{ id: string; slug: string }> {
  const res = await page.request.get("/api/shops");
  const { shops } = (await res.json()) as { shops: Array<{ id: string; slug: string }> };
  const found = shops.find((s) => !ranked.includes(s.id));
  expect(found, "the seed always leaves unranked places").toBeTruthy();
  return { id: found!.id, slug: found!.slug };
}

async function auditStep(page: Page, name: string, project: string): Promise<number> {
  await settled(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  writeFileSync(
    join(EVIDENCE, `axe-${name}-${project}.json`),
    JSON.stringify(
      {
        url: page.url(),
        passes: results.passes.length,
        violations: results.violations.map((v) => ({
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
  expect(bad.map((v) => `${v.id}: ${v.help}`).join("\n")).toBe("");
  return bad.length;
}

/** A 1x1 PNG, so the upload path is exercised without committing a fixture. */
function onePixelPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}
