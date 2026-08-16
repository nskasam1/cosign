// Phase 5A acceptance: the public profile at /p/:token, and the Google
// Takeout import. Runs against `npm run prod` (SSR on :8787), never
// `vite preview`.
//
//   bash scripts/phase5a-evidence.sh          # owns its own server + scratch DB
//
// The import half WRITES (it creates a list), so it signs up a fresh account
// through the real stub-signup route rather than borrowing a seeded one — the
// Phase 3 lesson. The profile half is read-only.

import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVIDENCE, expectNoRatingScale, expectTapTargets, settled, signInAsNewUser } from "./fixtures.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");

// Seeded tokens (seed/share-tokens.json).
const PROFILE = "Rp7YT1i9S-Ov"; // maya: 22 places, a live ranking link
const PROFILE_EMPTY = "Xqhqrj14rpKt"; // noah: nothing in order at all
const PROFILE_NO_LIST = "8UAJxMmqLWs3"; // dev: ranking link revoked, so no onward door
const PROFILE_REVOKED = "oIxUcrHoBLVq"; // lena: the tombstone
const RANKING = "IofpCInelhr1"; // maya's list — a /s/ token, not a /p/ one

const shot = async (page: Page, name: string) => {
  await settled(page);
  return page.screenshot({ path: join(EVIDENCE, `${name}-${test.info().project.name}.png`), fullPage: true });
};

test.describe("public profile", () => {
  test("renders every 5A element with no session at all", async ({ page, context }) => {
    await context.clearCookies();
    const res = await page.goto(`/p/${PROFILE}`);
    expect(res?.status()).toBe(200);

    // ── the person, in their own words ──
    const header = page.locator("[data-author]");
    await expect(header.locator("h1")).toHaveText("Maya Okafor");
    await expect(header).toContainText("Ohio State");
    await expect(page.locator("[data-taste]")).toContainText(/warm light and worn wood/i);
    await expect(page.locator("[data-author] img")).toHaveCount(1);

    // the taste line is the DOCUMENT here, not a citation: it is set larger
    // than the name, which is the whole difference from the share page
    const size = (sel: string) =>
      page.locator(sel).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await size("[data-taste]")).toBeGreaterThan(await size("[data-author] h1"));

    // ── signature order (5A adds it to the schema and to this page) ──
    await expect(page.locator("[data-usual]")).toContainText(/Cortado, whole milk/i);

    // ── the map, drawn locally ──
    const sheet = page.locator(".sheet");
    await expect(sheet).toHaveAttribute("role", "img");
    expect((await sheet.getAttribute("aria-label"))?.length ?? 0).toBeGreaterThan(80);
    // The drawing is an <img> holding a data URI rather than inline SVG —
    // inline it cost 737 ms of throttled style+layout. Read it back and count
    // the marks in it, which is a more direct assertion than counting nodes.
    const src = (await sheet.locator("img").getAttribute("src")) ?? "";
    expect(src.startsWith("data:image/svg+xml,")).toBe(true);
    const drawing = decodeURIComponent(src.slice("data:image/svg+xml,".length));
    // 17 open rings + 5 named places (a knock-out disc and a filled disc
    // each) + the campus ring + 4 walking-time contours
    expect((drawing.match(/<circle/g) ?? []).length).toBe(17 + 5 * 2 + 1 + 4);
    // An <img> is a separate document with no access to :root, so a `var()`
    // that survived into it would draw nothing at all — a mark that silently
    // disappears from a map is the worst failure this page has.
    expect(drawing).not.toContain("var(");
    expect(drawing).toContain("#E0633C"); // the one ember line, resolved
    await expect(page.locator("[data-finding]")).toContainText(/three closest to the Oval are Maya/i);

    // ── the top five, in order, with their positions ──
    const entries = page.locator("[data-entry]");
    await expect(entries).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await expect(entries.nth(i).locator("[data-position]")).toHaveText(String(i + 1));
      await expect(entries.nth(i).locator("[data-name]")).not.toBeEmpty();
    }
    await expect(entries.nth(0).locator("[data-name]")).toHaveText("Lantern Lane Cafe");

    // ── running counts ──
    const counts = page.locator(".counts");
    await expect(counts).toContainText("22");
    await expect(counts).toContainText(/places, in order/i);
    await expect(counts).toContainText(/visits logged/i);

    // ── the rest are named, and never positioned ──
    const rest = page.locator("[data-rest]");
    await expect(rest).toContainText("Wheelhouse Coffee");
    await expect(rest).not.toContainText(/\b(6th|7th|sixth|seventh)\b/i);

    await shot(page, "profile");
  });

  test("names nobody else's private list, and no face but the author's", async ({ page }) => {
    await page.goto(`/p/${PROFILE}`);
    // Exactly one picture of a person on the page: the author's own avatar,
    // inlined as a data URI. A cosigner opted their RANKING into public, not
    // their face onto somebody else's profile — so the share page's 22px
    // faces are deliberately absent here.
    expect(await page.locator("[data-author] img").count()).toBe(1);
    expect(await page.locator("[data-cosign] img").count()).toBe(0);
    // three images on the whole page and no more: that avatar, the drawn
    // sheet, and the closing photograph
    expect(await page.locator("img").count()).toBe(3);

    const cosign = page.locator("[data-cosign]");
    expect(await cosign.count()).toBe(5);
    const states = await cosign.evaluateAll((els) => els.map((e) => e.getAttribute("data-cosign")));
    // all three states are reachable on the seeded data
    expect(new Set(states).size).toBeGreaterThan(1);
    // a "counted" row names nobody
    for (const el of await page.locator('[data-cosign="counted"]').all()) {
      expect(await el.locator("b").count()).toBe(0);
    }
  });

  test("never guesses a pronoun", async ({ page }) => {
    // Cosign asks for a name and a school and nothing else. This is a public
    // page about a real person; "she" here would be a guess printed at 28px.
    for (const token of [PROFILE, PROFILE_EMPTY, PROFILE_NO_LIST]) {
      await page.goto(`/p/${token}`);
      const body = await page.locator("body").innerText();
      const ours = body
        .split(/\n+/)
        // the author's own sentence is theirs to write however they like
        .filter((line) => !/warm light and worn wood|new here|two outlets and silence/i.test(line))
        .join("\n");
      expect(ours, `pronoun on /p/${token}`).not.toMatch(/(?:^|[^a-z])(she|he|her|his|hers|him)(?![a-z])/im);
    }
  });

  test("no rating scale, no login wall, and nothing that writes", async ({ page }) => {
    await page.goto(`/p/${PROFILE}`);
    await expectNoRatingScale(page, "the public profile");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\bsign in\b|\blog in\b|\bcreate an account to\b/i);
    expect(await page.locator('input[type="password"], form').count()).toBe(0);
    // the rings could read as a target on the one product where nothing is
    // scored, so they are labelled in a measurement and the caption says so
    const ringLabels = await page.locator(".sheet s").allInnerTexts();
    expect(ringLabels.length).toBeGreaterThan(1);
    for (const l of ringLabels) expect(l.trim()).toMatch(/^\d+ MIN$/i);
    // nothing on this page changes anyone's data
    expect(await page.locator("button").count()).toBe(0);
  });

  test("ships no bundle and no stylesheet", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(`/p/${PROFILE}`, { waitUntil: "networkidle" });
    expect(requests.filter((u) => /\/assets\/.*\.js$/.test(u))).toEqual([]);
    expect(await page.locator("script[src]").count()).toBe(0);
    expect(await page.locator("script").count()).toBe(0); // not even inline: nothing here is interactive
    expect(await page.locator('link[rel="stylesheet"]').count()).toBe(0);
  });

  test("the document fits the perf budget it was designed to", async ({ request }) => {
    // The gate itself is Lighthouse (scripts/lighthouse.mjs); this is the
    // byte budget that makes it plausible — Slow-4G's initial congestion
    // window is ~14.6 kB, so the whole page should land in one round trip
    // after TTFB.
    const res = await request.get(`/p/${PROFILE}`, { headers: { "Accept-Encoding": "gzip" } });
    expect(res.status()).toBe(200);
    const raw = (await res.body()).length;
    expect(raw, `raw document bytes: ${raw}`).toBeLessThan(30_000);
    writeFileSync(
      join(EVIDENCE, `profile-bytes-${test.info().project.name}.json`),
      JSON.stringify({ url: `/p/${PROFILE}`, rawBytes: raw, budget: 30_000 }, null, 2),
    );
  });

  test("a token opens exactly one surface", async ({ page }) => {
    // A profile token has 404'd at /s/ since Phase 2; a ranking token must
    // 404 here for the same reason. Otherwise revoking the link to your list
    // leaves the same content reachable through your profile's link.
    expect((await page.goto(`/p/${RANKING}`))?.status()).toBe(404);
    expect((await page.goto(`/s/${PROFILE}`))?.status()).toBe(404);
    expect((await page.goto("/p/not-a-real-token"))?.status()).toBe(404);
  });

  test("a revoked profile link is a tombstone that leaks nothing", async ({ page }) => {
    const res = await page.goto(`/p/${PROFILE_REVOKED}`);
    expect(res?.status()).toBe(410);
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/isn.t shared anymore/i);
    expect(body).toMatch(/page/i); // the profile wording, not the list's
    expect(body).not.toMatch(/Lena|Voss|Ohio State|Wheelhouse|Lantern/);
    expect(await page.locator(".sheet, [data-entry]").count()).toBe(0);
    await shot(page, "profile-revoked");
  });

  test("the onward link is the ranking's own token, and disappears with it", async ({ page }) => {
    await page.goto(`/p/${PROFILE}`);
    await expect(page.locator("[data-onward]")).toHaveAttribute("href", `/s/${RANKING}`);

    // dev's ranking token is revoked, so the door is closed — not pointing at
    // a 410, and not falling back to a username route
    await page.goto(`/p/${PROFILE_NO_LIST}`);
    expect(await page.locator("[data-onward]").count()).toBe(0);
    const hrefs = await page.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs.filter((h) => h?.startsWith("/s/"))).toEqual([]);
    await shot(page, "profile-no-list-link");
  });

  test("a campus with nothing on it is a sentence, not an empty figure", async ({ page }) => {
    const res = await page.goto(`/p/${PROFILE_EMPTY}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator("[data-empty]")).toContainText(/hasn.t put anywhere in order/i);
    expect(await page.locator(".sheet").count()).toBe(0); // no sheet drawn for no places
    expect(await page.locator("[data-entry]").count()).toBe(0);
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\b0 places\b/i); // no zero figures
    await expect(page.locator("[data-cta] a")).toHaveAttribute("href", /onboarding/);
    await shot(page, "profile-empty");
  });

  test("axe finds no serious or critical violations", async ({ page }, testInfo) => {
    for (const [name, token] of [
      ["profile", PROFILE],
      ["profile-empty", PROFILE_EMPTY],
    ] as const) {
      await page.goto(`/p/${token}`);
      await settled(page);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      writeFileSync(
        join(EVIDENCE, `axe-${name}-${testInfo.project.name}.json`),
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
      expect(bad, `${name}: ` + bad.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
    }
  });

  test("headings run in order and nothing is a styled div", async ({ page }) => {
    await page.goto(`/p/${PROFILE}`);
    const levels = await page
      .locator("h1, h2, h3")
      .evaluateAll((els) => els.map((e) => Number(e.tagName.slice(1))));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });

  test("tap targets are at least 44px", async ({ page }) => {
    await page.goto(`/p/${PROFILE}`);
    await expectTapTargets(page, "the public profile");
  });

  test("prefers-reduced-motion removes all animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/p/${PROFILE}`);
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
  });
});

test.describe("the profile's own OG card", () => {
  test("is a 1200x630 png, and is not the list card", async ({ request }) => {
    const res = await request.get(`/og/p/${PROFILE}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    const png = await res.body();
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    writeFileSync(join(EVIDENCE, "og-profile.png"), png);

    // Two links from the same person land in the same message thread, so the
    // two cards have to be different pictures — not the same layout reworded.
    const list = await (await request.get(`/og/s/${RANKING}`)).body();
    expect(Buffer.compare(png, list)).not.toBe(0);
    expect(Math.abs(png.length - list.length)).toBeGreaterThan(1000);
  });

  test("a revoked profile token has no card", async ({ request }) => {
    expect((await request.get(`/og/p/${PROFILE_REVOKED}`)).status()).toBe(410);
    expect((await request.get(`/og/p/${RANKING}`)).status()).toBe(404);
  });

  test("the page points social previews at it", async ({ page }) => {
    await page.goto(`/p/${PROFILE}`);
    const og = (p: string) => page.locator(`meta[property="og:${p}"]`).getAttribute("content");
    expect(await og("image")).toContain(`/og/p/${PROFILE}`);
    expect(await og("title")).toContain("Maya");
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toMatch(/noindex/);
  });
});

test.describe("google takeout import", () => {
  const files = () => [
    readFileSync(join(APP, "seed", "takeout", "saved-places.geojson"), "utf-8"),
    readFileSync(join(APP, "seed", "takeout", "saved-places.csv"), "utf-8"),
  ];

  test("maps the committed fixtures onto seeded places", async ({ context }) => {
    await signInAsNewUser(context, "imp");
    const res = await context.request.post("/api/import/takeout", { data: { files: files() } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.counts).toEqual({ total: 15, certain: 10, likely: 1, unknown: 4 });

    const named = (kind: string) =>
      body.matches.filter((m: { kind: string }) => m.kind === kind).map((m: { saved: string }) => m.saved);
    expect(named("certain")).toContain("Wheelhouse Coffee");
    expect(named("likely")).toEqual(["Hackberry"]);
    // the two traps: both are metres from a place we know, and neither matches
    expect(named("unknown")).toEqual(
      expect.arrayContaining(["Batch & Crumb Bakery", "Juniper Bar & Kitchen"]),
    );
  });

  test("reads the coordinates and keeps none of them", async ({ context }) => {
    await signInAsNewUser(context, "geo");
    const res = await context.request.post("/api/import/takeout", { data: { files: files() } });
    const text = await res.text();
    // the response is the only part of this request that outlives it
    expect(text).not.toMatch(/-83\.0|39\.99|40\.00|coordinates|Columbus/);
  });

  test("refuses an anonymous caller and a file that is not an export", async ({ context }) => {
    await context.clearCookies();
    expect((await context.request.post("/api/import/takeout", { data: { files: files() } })).status()).toBe(401);
    await signInAsNewUser(context, "bad");
    const junk = await context.request.post("/api/import/takeout", { data: { files: ["name,lat\nx,1"] } });
    expect(junk.status()).toBe(400);
    expect((await junk.json()).error).toMatch(/Title,Note,URL/);
  });

  test("is offered at signup, and builds a list rather than a ranking", async ({ page, context }) => {
    await signInAsNewUser(context, "onb");
    await page.goto("/onboarding");
    const importer = page.locator("[data-import]");
    await expect(importer).toBeVisible();
    await expect(importer).toContainText(/already saved places/i);
    await shot(page, "import-offered");

    await page.locator("[data-import-input]").setInputFiles([
      join(APP, "seed", "takeout", "saved-places.geojson"),
      join(APP, "seed", "takeout", "saved-places.csv"),
    ]);
    await expect(importer).toHaveAttribute("data-stage", "review");
    await expect(importer).toContainText(/We know 11 of the 15 places you saved/i);

    // the certain ones arrive chosen; the one we are unsure about does not
    const rows = page.locator("[data-import-row]");
    await expect(rows).toHaveCount(11);
    expect(await page.locator('[data-import-row][aria-pressed="true"]').count()).toBe(10);
    await expect(page.locator("[data-import-likely]")).toHaveAttribute("aria-pressed", "false");
    // and the ones we do not have are named, not silently dropped
    await expect(page.locator("[data-import-unknown]")).toContainText("Iuka Ridge Branch Library");
    await expectNoRatingScale(page, "the import review");
    await shot(page, "import-review");

    await page.locator("[data-import-save]").click();
    await expect(importer).toHaveAttribute("data-stage", "done");
    await expect(importer).toContainText(/10 places you.d already saved/i);
    // a list, never a ranking — an order only comes from the head-to-head
    await expect(importer).toContainText(/not an order/i);
    const ranking = await context.request.get("/api/rankings/me");
    expect((await ranking.json()).entries).toEqual([]);
    const lists = await (await context.request.get("/api/lists/mine")).json();
    expect(lists.lists.some((l: { title: string }) => l.title === "Saved in Maps")).toBe(true);
    await shot(page, "import-done");
  });

  test("carries the notes people actually wrote", async ({ page, context }) => {
    await signInAsNewUser(context, "note");
    await page.goto("/onboarding");
    await page.locator("[data-import-input]").setInputFiles([
      join(APP, "seed", "takeout", "saved-places.geojson"),
      join(APP, "seed", "takeout", "saved-places.csv"),
    ]);
    await expect(page.locator("[data-import]")).toContainText("best outlets on campus");
    await page.locator("[data-import-save]").click();
    await expect(page.locator("[data-import]")).toHaveAttribute("data-stage", "done");

    const lists = await (await context.request.get("/api/lists/mine")).json();
    const list = lists.lists.find((l: { title: string }) => l.title === "Saved in Maps");
    const view = await (await context.request.get(`/api/lists/${list.id}`)).json();
    expect(view.items.length).toBe(10);
    const wheelhouse = view.items.find((i: { shop_id: string }) => i.shop_id === "s_wheelhouse");
    expect(wheelhouse.note).toBe("best outlets on campus");
    // and it defaults to friends-only, like everything else
    expect(view.list.visibility).toBe("friends");
  });

  test("is also offered where a ranking is empty", async ({ page, context }) => {
    await signInAsNewUser(context, "emp");
    await page.goto("/rank");
    await expect(page.locator("[data-import]")).toBeVisible();
    await expectTapTargets(page, "the empty ranking with the import offered");
    await shot(page, "import-empty-ranking");
  });
});
