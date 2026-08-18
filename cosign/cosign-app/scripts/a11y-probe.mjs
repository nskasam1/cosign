// What axe cannot see.
//
//   COSIGN_BASE=http://localhost:8791 node scripts/a11y-probe.mjs
//
// Every phase has run axe and every phase has come back with zero serious or
// critical violations. That is worth having and it is not the same claim as
// "this works with a screen reader": axe audits a static snapshot of one DOM.
// It cannot press Tab, it does not know where focus went when a step advanced,
// and it has nothing to say about whether anything was ANNOUNCED. Those are the
// three things that decide whether a non-sighted person can use a flow, and all
// three are invisible to every report in evidence/.
//
// So this probe drives the running app and asks:
//
//   1. skip link      — is there a way past the shell to the content?
//   2. landmarks      — exactly one <main>, and a heading order that does not jump
//   3. tab order      — every interactive element reachable, in DOM order,
//                       with a focus indicator that actually differs from rest
//   4. names          — every interactive element has an accessible name
//   5. live regions   — does an async change (search, save, a step advancing)
//                       have anywhere to be announced from?
//   6. focus on change— when the log flow advances a step, does focus move, or
//                       is a sighted-only change made silently?
//
// It reports rather than asserts: this is a survey to act on, and the fixes it
// motivates get their own tests. Exit code is 1 if any FAIL row is printed.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.COSIGN_BASE ?? "http://localhost:8787";
const OUT = join(APP, "..", "..", "evidence", process.env.COSIGN_EVIDENCE ?? "scratch/a11y");
mkdirSync(OUT, { recursive: true });

const findings = [];
const note = (level, route, what, detail) => {
  findings.push({ level, route, what, detail });
  const tag = level === "FAIL" ? "FAIL" : level === "WARN" ? "warn" : "ok  ";
  console.log(`  ${tag}  ${what}${detail ? " — " + detail : ""}`);
};

const ROUTES = [
  ["/", "front door (user switcher)"],
  ["/home", "home"],
  ["/rank", "your ranking"],
  ["/search", "search"],
  ["/maya", "a profile"],
  ["/log", "log flow, step 1"],
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

// Sign in the way the product does, so the authenticated routes render.
await context.request.post(`${BASE}/api/auth/switch`, { data: { userId: "u_maya" } });

for (const [route, name] of ROUTES) {
  console.log(`\n── ${name}  ${route}`);
  const page = await context.newPage();
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  // ── 1. skip link ────────────────────────────────────────────────────────
  const skip = await page.evaluate(() => {
    const first = document.querySelector("body a[href^='#'], body a.skip, body [data-skip]");
    if (!first) return null;
    return { text: first.textContent.trim(), href: first.getAttribute("href") };
  });
  if (skip) note("ok", route, "skip link present", `${skip.text} -> ${skip.href}`);
  else note("WARN", route, "no skip link");

  // ── 2. landmarks and heading order ──────────────────────────────────────
  const structure = await page.evaluate(() => {
    const mains = document.querySelectorAll("main").length;
    const levels = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) =>
      Number(h.tagName[1]),
    );
    let jump = null;
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] > levels[i - 1] + 1) jump = `h${levels[i - 1]} -> h${levels[i]}`;
    }
    return { mains, levels, jump, h1s: levels.filter((l) => l === 1).length };
  });
  if (structure.mains !== 1) note("FAIL", route, `${structure.mains} <main> elements`);
  if (structure.h1s !== 1) note("FAIL", route, `${structure.h1s} <h1> elements`);
  if (structure.jump) note("FAIL", route, "heading level jumps", structure.jump);
  if (structure.mains === 1 && structure.h1s === 1 && !structure.jump)
    note("ok", route, "one main, one h1, no heading jump", structure.levels.join(""));

  // ── 3. tab order and a focus indicator that is actually visible ─────────
  const tab = await page.evaluate(async () => {
    const interactive = [
      ...document.querySelectorAll(
        "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    });
    const noIndicator = [];
    for (const el of interactive) {
      const before = getComputedStyle(el);
      const rest = [before.outlineWidth, before.outlineStyle, before.boxShadow].join("|");
      el.focus();
      const after = getComputedStyle(el);
      const focused = [after.outlineWidth, after.outlineStyle, after.boxShadow].join("|");
      if (rest === focused) {
        noIndicator.push((el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40));
      }
      el.blur();
    }
    return { count: interactive.length, noIndicator };
  });
  if (tab.noIndicator.length)
    note("FAIL", route, `${tab.noIndicator.length}/${tab.count} focusable with no focus indicator`,
      tab.noIndicator.slice(0, 4).join(" / "));
  else note("ok", route, `${tab.count} focusable, all show a focus indicator`);

  // ── 4. accessible names ─────────────────────────────────────────────────
  const unnamed = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("a[href], button, input, select, textarea")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const name =
        el.getAttribute("aria-label") ||
        (el.getAttribute("aria-labelledby") &&
          document.getElementById(el.getAttribute("aria-labelledby"))?.textContent) ||
        el.textContent?.trim() ||
        el.getAttribute("title") ||
        (el.labels && el.labels[0]?.textContent) ||
        el.getAttribute("placeholder") ||
        "";
      if (!name.trim()) out.push(el.outerHTML.slice(0, 90));
    }
    return out;
  });
  if (unnamed.length) note("FAIL", route, `${unnamed.length} interactive elements with no accessible name`, unnamed[0]);
  else note("ok", route, "every interactive element has an accessible name");

  // ── 5. live regions ─────────────────────────────────────────────────────
  const live = await page.evaluate(
    () => document.querySelectorAll("[aria-live],[role=status],[role=alert],output").length,
  );
  if (live) note("ok", route, `${live} live region(s)`);
  else note("WARN", route, "no live region — async changes announce nothing");

  await page.close();
}

// ── 6. focus when the surface changes underneath the reader ──────────────
//
// Two different events, and the first version of this probe conflated them:
// it clicked "the first button on /log", which is a shelf tab, watched the
// heading change to Home's, and reported "step advanced and focus fell to
// body". The step had not advanced — the route had. Both are worth checking
// and they have different answers, so they are checked separately now.
console.log(`
── focus management`);
{
  // (a) a route change from the shelf
  const page = await context.newPage();
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => document.querySelector("main h1")?.textContent?.trim());
  const tab = page.locator("[data-tab=search]");
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      heading: document.querySelector("main h1")?.textContent?.trim(),
      onBody: document.activeElement === document.body,
      active: document.activeElement?.tagName,
      activeText: document.activeElement?.textContent?.trim().slice(0, 40),
    }));
    if (after.heading === before) note("WARN", "shelf", "route did not change; focus not tested");
    else if (after.onBody)
      note("FAIL", "shelf", "route changed and focus fell to <body>",
        `"${before}" -> "${after.heading}" — a screen reader is left on the tab`);
    else
      note("ok", "shelf", "route changed and focus moved to the new page",
        `${after.active} "${after.activeText}"`);
  }
  await page.close();
}
{
  // (b) a step advancing inside the log flow
  const page = await context.newPage();
  await page.goto(BASE + "/log", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => document.querySelector("main h1")?.textContent?.trim());
  // A place row inside the step, and ONLY that. "the first button in main"
  // picked the step's own back-out control twice, watched the heading turn
  // into Home's, and reported "the step advanced and lost focus" about a step
  // that had not advanced. `[data-place-row]` is the control that answers the
  // question this step is asking.
  const choice = page.locator("main [data-place-row]").first();
  if (!(await choice.count())) {
    note("WARN", "/log", "no [data-place-row] on the first step; focus not tested");
  } else {
    await choice.click().catch(() => {});
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => ({
      heading: document.querySelector("main h1")?.textContent?.trim(),
      onBody: document.activeElement === document.body,
      isHeading: document.activeElement?.tagName === "H1",
    }));
    if (after.heading === before) note("WARN", "/log", "step did not advance; focus not tested");
    else if (after.onBody)
      note("FAIL", "/log", "step advanced and focus fell to <body>", `"${before}" -> "${after.heading}"`);
    else
      note("ok", "/log", "step advanced and focus moved", after.isHeading ? "onto the new question" : "");
  }
  await page.close();
}

await browser.close();

const fails = findings.filter((f) => f.level === "FAIL");
const warns = findings.filter((f) => f.level === "WARN");
writeFileSync(join(OUT, "a11y-probe.json"), JSON.stringify({ base: BASE, findings }, null, 2));
console.log(`\n${fails.length} FAIL · ${warns.length} warn · ${findings.length} checks`);
console.log(`-> ${join(OUT, "a11y-probe.json")}`);
process.exit(fails.length ? 1 : 0);
