// Shared Playwright helpers for the Phase 3 suite.
//
// Signing in happens through the API, never through the UserSwitcher UI: a
// tap spent picking a seeded user would land inside the <= 8-tap and <= 10 s
// measurements and quietly inflate both.

import { expect, type Page, type BrowserContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EVIDENCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "evidence",
  process.env.COSIGN_EVIDENCE ?? "phase3",
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
 * The share page's no-rating-scale assertions (e2e/share.spec.ts), reusable
 * so they can run on EVERY step of the flow rather than only on its last
 * screen — a scale that appears on step 3 is exactly what an end-state check
 * misses.
 */
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
  const body = await page.locator("body").innerText();
  expect(body, where).not.toMatch(/★|☆|⭐|👍|👎/u);
  expect(body, where).not.toMatch(/\b\d(?:\.\d)?\s*(?:\/|out of)\s*(?:5|10)\b/i);
  expect(body, where).not.toMatch(/\brat(?:e|ing)\b/i);
}

/** Every anchor and button on screen clears the 44px minimum target. */
export async function expectTapTargets(page: Page, where: string): Promise<void> {
  for (const el of await page.locator("a:visible, button:visible").all()) {
    const box = await el.boundingBox();
    if (!box) continue;
    expect
      .soft(Math.min(box.width, box.height), `${where}: ${(await el.innerText()).slice(0, 30)}`)
      .toBeGreaterThanOrEqual(44);
  }
}
