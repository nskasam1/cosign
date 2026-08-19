// Phase 2 acceptance: the public share page. Runs against the built app
// (SSR on :8787), never `vite preview`.
//
//   bash scripts/phase2-evidence.sh      # owns its own server + scratch DB
//
// Run it by hand and it writes to evidence/scratch/, not evidence/phase2/ —
// the line that used to sit here promised the opposite, which is how the
// script itself came to run a bare `npx playwright test` and lose a phase's
// artifacts to the gitignored directory.
//
// The template's contract with this spec is a small set of data-* hooks
// (data-entry / data-chip / data-cosign / data-nophoto / data-cta), so the
// assertions survive a visual redesign but not a missing requirement.

import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE } from "./fixtures.ts";

// The evidence directory comes from `e2e/fixtures.ts`, which defaults to
// `evidence/scratch/`. This file used to compute its own with `?? "phase2"`:
// Phase 3 fixed the hard-coded path and left the FALLBACK pointing at a
// signed-off phase, which is the same loaded gun one level down — a bare
// `npx playwright test share.spec.ts` against any database rewrote Phase 2's
// accepted screenshots and its OG image. Phase 4 fixed the same fallback in
// two other files and missed this one. One definition now, and it is scratch.

// Seeded tokens (seed/share-tokens.json).
const LIST_TOKEN = "IofpCInelhr1"; // maya's canonical ranking, 22 entries
const REVOKED_TOKEN = "e3lsicjJ4Q3S"; // dev's ranking, revoked 2026-08-01
const PROFILE_TOKEN = "Rp7YT1i9S-Ov"; // profile-scoped: not a list surface (5A)

const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(EVIDENCE, `${name}.png`), fullPage: true });

test.describe("public share page", () => {
  test("renders every decision-2 element with no session at all", async ({ page, context }) => {
    await context.clearCookies();
    const res = await page.goto(`/s/${LIST_TOKEN}`);
    expect(res?.status()).toBe(200);

    // ── header: the author as a person ──
    const header = page.locator("[data-author]");
    await expect(header).toBeVisible();
    await expect(header).toContainText("Maya Okafor");
    await expect(header).toContainText("Ohio State");
    await expect(header).toContainText(/warm light and worn wood/i); // taste line
    await expect(page.locator("[data-author] img")).toHaveCount(1); // author photo

    // ── the list itself ──
    await expect(page.locator("h1")).toContainText(/ranked/i);
    const entries = page.locator("[data-entry]");
    await expect(entries).toHaveCount(22);
    await expect(page.locator("ol")).toHaveCount(1);

    // every entry carries position + name + a line + at least one intent tag
    for (const i of [0, 1, 10, 21]) {
      const e = entries.nth(i);
      await expect(e.locator("[data-position]")).toHaveText(String(i + 1));
      await expect(e.locator("[data-name]")).not.toBeEmpty();
      await expect(e.locator("[data-line]")).not.toBeEmpty();
      await expect(e.locator("[data-taglist]")).not.toBeEmpty(); // visible intent tags
      expect((await e.getAttribute("data-tags"))?.length).toBeGreaterThan(0); // filter source
    }
    await expect(entries.nth(0).locator("[data-name]")).toHaveText("Lantern Lane Cafe");

    // ── no-photo fallback is designed, present, and not an emoji ──
    const noPhoto = page.locator("[data-nophoto]");
    await expect(noPhoto).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const text = (await noPhoto.nth(i).innerText()).trim();
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text.length).toBeGreaterThan(0); // a designed mark, not an empty box
    }

    // ── cosigned-by, all three states ──
    const cosign = page.locator("[data-cosign]");
    expect(await cosign.count()).toBe(22);
    const states = await cosign.evaluateAll((els) => els.map((e) => e.getAttribute("data-cosign")));
    expect(new Set(states).size).toBeGreaterThan(1); // named / counted / none all occur
    expect(states).toContain("named");

    // ── filter chips at the top, CTA at the bottom ──
    const chips = page.locator("[data-chip]");
    expect(await chips.count()).toBeGreaterThan(2);
    const chipY = await chips.first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const listY = await page.locator("ol").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const ctaY = await page.locator("[data-cta]").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const lastEntryY = await entries.last().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(chipY).toBeLessThan(listY); // chips above the list
    expect(ctaY).toBeGreaterThan(lastEntryY); // CTA below the last entry
    await expect(page.locator("[data-cta] a")).toHaveAttribute("href", /onboarding/);

    await shot(page, `share-${test.info().project.name}`);
  });

  test("filter chips narrow the list to one intent", async ({ page }) => {
    await page.goto(`/s/${LIST_TOKEN}`);
    const before = await page.locator("[data-entry]:visible").count();
    const chip = page.locator("[data-chip]").first();
    const tag = await chip.getAttribute("data-chip");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const after = await page.locator("[data-entry]:visible").count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    for (const el of await page.locator("[data-entry]:visible").all()) {
      expect((await el.getAttribute("data-tags"))?.split(" ")).toContain(tag);
    }
    await shot(page, `share-filtered-${test.info().project.name}`);
    await chip.click(); // toggling off restores everything
    await expect(page.locator("[data-entry]:visible")).toHaveCount(before);
  });

  test("no rating-scale input, no cosign button, no login wall", async ({ page }) => {
    await page.goto(`/s/${LIST_TOKEN}`);
    expect(await page.locator('input[type="range"], input[type="number"], [role="slider"]').count()).toBe(0);
    expect(await page.locator('[aria-valuenow], [role="radiogroup"], select').count()).toBe(0);
    expect(await page.locator('input[type="password"], form').count()).toBe(0);
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/★|☆|⭐|👍|👎/u);
    expect(body).not.toMatch(/\b\d(?:\.\d)?\s*(?:\/|out of)\s*(?:5|10)\b/i);
    expect(body).not.toMatch(/\brat(?:e|ing)\b/i);
    expect(body).not.toMatch(/\bsign in\b|\blog in\b|\bcreate an account to\b/i);
    // the only interactive controls are the filter chips (plus "Everything")
    // and the CTA link — nothing on this page changes anyone's data
    const buttons = await page.locator("button").count();
    const chips = await page.locator("[data-chip]").count();
    expect(buttons).toBe(chips + 1);
    expect(await page.locator("[data-chip-all]").count()).toBe(1);
  });

  test("the share page does not ship the SPA bundle", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(`/s/${LIST_TOKEN}`, { waitUntil: "networkidle" });
    expect(requests.filter((u) => /\/assets\/.*\.js$/.test(u))).toEqual([]);
    expect(await page.locator("script[src]").count()).toBe(0);
    expect(await page.locator('link[rel="stylesheet"]').count()).toBe(0); // CSS is inline
  });

  test("a revoked token shows a tombstone, never the list", async ({ page }) => {
    const res = await page.goto(`/s/${REVOKED_TOKEN}`);
    expect(res?.status()).toBe(410);
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/isn.t shared anymore/i); // typographic apostrophe
    expect(await page.locator("[data-entry]").count()).toBe(0);
    expect(body).not.toMatch(/Lantern Lane|Foundry|Wheelhouse/);
    await shot(page, `share-revoked-${test.info().project.name}`);
  });

  test("an unknown token 404s and a profile token is not a list surface", async ({ page }) => {
    expect((await page.goto("/s/not-a-real-token"))?.status()).toBe(404);
    expect((await page.goto(`/s/${PROFILE_TOKEN}`))?.status()).toBe(404);
  });

  test("axe finds no serious or critical violations", async ({ page }, testInfo) => {
    await page.goto(`/s/${LIST_TOKEN}`);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    writeFileSync(
      join(EVIDENCE, `axe-share-${testInfo.project.name}.json`),
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
    expect(bad, bad.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
  });

  test("tap targets are at least 44px", async ({ page }) => {
    await page.goto(`/s/${LIST_TOKEN}`);
    for (const el of await page.locator("a, button").all()) {
      const box = await el.boundingBox();
      if (!box) continue;
      expect.soft(Math.min(box.width, box.height), await el.innerText()).toBeGreaterThanOrEqual(44);
    }
  });

  test("prefers-reduced-motion removes all animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/s/${LIST_TOKEN}`);
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
    await shot(page, `share-reduced-motion-${test.info().project.name}`);
  });
});

test.describe("open graph image", () => {
  // What the card SAYS is asserted in server/pages/og.test.ts, on the element
  // tree satori is handed. It cannot be asserted from here: satori converts
  // every glyph to a path before resvg rasterises it, so the bytes below
  // contain no text at all. This test was called "renders a 1200x630 png with
  // the author, title, places and cosign count" while checking the header and
  // nothing else — the card could have named the wrong person for a phase.
  test("renders a 1200x630 png", async ({ request }) => {
    const res = await request.get(`/og/s/${LIST_TOKEN}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    const png = await res.body();
    expect(png.length).toBeGreaterThan(5_000);
    // PNG IHDR: width/height are big-endian uint32 at bytes 16 and 20
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    writeFileSync(join(EVIDENCE, "og-share.png"), png);
  });

  test("a revoked token has no og image", async ({ request }) => {
    expect((await request.get(`/og/s/${REVOKED_TOKEN}`)).status()).toBe(410);
  });

  test("the share page points social previews at that image", async ({ page }) => {
    await page.goto(`/s/${LIST_TOKEN}`);
    const og = (p: string) => page.locator(`meta[property="og:${p}"]`).getAttribute("content");
    expect(await og("image")).toContain(`/og/s/${LIST_TOKEN}`);
    expect(await og("title")).toContain("Maya");
    expect(await page.locator('meta[name="twitter:card"]').getAttribute("content")).toBe("summary_large_image");
    // unlisted means unlisted: never indexed (decision 12)
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toMatch(/noindex/);
  });
});
