// Shared Playwright helpers for the Phase 3 suite.
//
// Signing in happens through the API, never through the UserSwitcher UI: a
// tap spent picking a seeded user would land inside the <= 8-tap and <= 10 s
// measurements and quietly inflate both.

import { expect, type Page, type BrowserContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Defaults to `scratch`, never to a phase that has been signed off. Every
// evidence run sets COSIGN_EVIDENCE explicitly; anything else — an ad-hoc
// `npx playwright test`, a spec run from an editor — writes somewhere it
// cannot do any harm. evidence/scratch/ is gitignored.
export const EVIDENCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "evidence",
  process.env.COSIGN_EVIDENCE ?? "scratch",
);
mkdirSync(EVIDENCE, { recursive: true });

/** Seeded fixtures (seed/users.json, seed/rankings.json). */
export const USERS = {
  /** No ranking at all — the empty-list branch, zero comparisons. */
  noah: "u_noah",
  /** Six ranked places: a head/middle/tail insertion costs 3 taps or fewer. */
  lena: "u_lena",
  /** Ten ranked places. */
  dev: "u_dev",
} as const;

export async function signIn(context: BrowserContext, userId: string): Promise<void> {
  const res = await context.request.post("/api/auth/switch", { data: { userId } });
  expect(res.status(), await res.text()).toBe(200);
}

/**
 * A brand-new account through the real stub-signup route — the only honest
 * empty fixture, because these tests write. Reusing a seeded empty user
 * (u_noah) works exactly once: the first test to log through the flow gives
 * them a ranking, and every later test asserting emptiness fails on state
 * its own suite created.
 */
export async function signInAsNewUser(context: BrowserContext, tag: string): Promise<string> {
  const username = `${tag}${Date.now().toString(36).slice(-6)}`;
  const res = await context.request.post("/api/auth/create", {
    data: { username, display_name: `Test ${tag}` },
  });
  expect(res.status(), await res.text()).toBe(201);
  return username;
}

/**
 * Let every running animation finish. Each step fades in over 200 ms, and a
 * screenshot or an axe run started inside that window measures a half-faded
 * element: axe reported the step glosses as 4.08:1 because it sampled
 * #817364 — muted at partial opacity — rather than the resting #9A8977,
 * which clears 4.5:1. WCAG applies to the resting state, so the fix is to
 * settle, not to repaint the token.
 */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))).then(() => undefined),
  );
}

export async function shot(page: Page, name: string, project: string) {
  await settled(page);
  return page.screenshot({ path: join(EVIDENCE, `${name}-${project}.png`), fullPage: true });
}

/**
 * A screenshot of exactly what the phone shows (Phase 4).
 *
 * The app shell is `position: sticky; bottom: 0`, and a full-page capture of
 * a sticky footer lands it wherever the scroll happened to be — in the
 * middle of the column, overlaying a row. That is a capture artifact, not
 * the design, and committing it as evidence would misrepresent the surface.
 * A viewport shot is also the more honest artifact for a shell: the shell's
 * whole claim is about where it sits on a 390x844 screen.
 */
export async function shotViewport(page: Page, name: string, project: string, scrollTo = 0) {
  await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
  await settled(page);
  await page.waitForTimeout(120);
  return page.screenshot({ path: join(EVIDENCE, `${name}-${project}.png`) });
}

/**
 * The share page's no-rating-scale assertions (e2e/share.spec.ts), reusable
 * so they can run on EVERY step of the flow rather than only on its last
 * screen — a scale that appears on step 3 is exactly what an end-state check
 * misses.
 */
/**
 * The one carve-out, and it is exact rather than clever: the product SAYS
 * why it has no ratings, on the surfaces where somebody would wonder, so the
 * word appears inside the sentence that rules it out. The promise is cut out
 * of the text and everything else is still checked — a promise sitting beside
 * a real "4.5/5" buys it nothing.
 */
const REFUSALS = ["A vote is a rating with extra steps", "a vote is a rating with extra steps"];

export async function expectNoRatingScale(page: Page, where: string): Promise<void> {
  const controls = await page
    .locator(
      // `progress` and `meter` are listed as elements, not roles: their
      // progressbar/meter roles are implicit, so a [role=...] selector
      // cannot see them.
      'input[type="range"], input[type="number"], progress, meter, [role="slider"], [role="progressbar"], [role="radiogroup"], [aria-valuenow], select',
    )
    .count();
  expect(controls, `rating-scale control on ${where}`).toBe(0);
  const raw = await page.locator("body").innerText();
  const body = REFUSALS.reduce((s, p) => s.split(p).join(" "), raw);
  expect(body, where).not.toMatch(/★|☆|⭐|👍|👎/u);
  expect(body, where).not.toMatch(/\b\d(?:\.\d)?\s*(?:\/|out of)\s*(?:5|10)\b/i);
  expect(body, where).not.toMatch(/\brat(?:e|ing)\b/i);
}

/**
 * Wait for a surface to have finished loading, by its own `data-state`.
 *
 * Every screen in this product marks its loading state with the same
 * attribute it marks itself with, so `[data-group]` and `[data-feed]` are on
 * screen before there is anything on them. Phase 4 shipped that bug on Home
 * (`[data-home]` also marked the loader) and it failed only under load; an
 * assertion that reads the DOM once, without Playwright's retry, finds the
 * loading screen every time.
 */
export async function loaded(page: Page, selector: string): Promise<void> {
  await page.locator(`${selector}:not([data-state="loading"])`).first().waitFor({ state: "visible" });
  await settled(page);
}

/**
 * Every control on screen clears the 44px minimum target.
 *
 * A link set inside a sentence is exempt, and deliberately: WCAG 2.5.8 and
 * 2.5.5 both carve out "the target is in a sentence or block of text",
 * because a word in a paragraph cannot be 44px tall without destroying the
 * paragraph. The exemption is narrow on purpose — it applies only to an
 * inline <a> whose parent also contains text of its own, so a bare inline
 * link standing in for a button is still caught, and every <button>, every
 * block link and every tab is checked as before.
 */
export async function expectTapTargets(page: Page, where: string): Promise<void> {
  for (const el of await page.locator("a:visible, button:visible").all()) {
    const box = await el.boundingBox();
    if (!box) continue;
    const inSentence = await el.evaluate((node) => {
      if (node.tagName !== "A") return false;
      if (getComputedStyle(node).display !== "inline") return false;
      // Walk up to the nearest block: "in a sentence" is a property of the
      // paragraph, not of whatever inline span happens to wrap the word.
      let block: HTMLElement | null = node.parentElement;
      while (block && getComputedStyle(block).display.startsWith("inline")) {
        block = block.parentElement;
      }
      if (!block) return false;
      const around = (block.textContent ?? "").replace(node.textContent ?? "", "").trim();
      return around.length > 0;
    });
    if (inSentence) continue;
    expect
      .soft(Math.min(box.width, box.height), `${where}: ${(await el.innerText()).slice(0, 30)}`)
      .toBeGreaterThanOrEqual(44);
  }
}
