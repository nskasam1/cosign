// Phase 1 acceptance evidence: the SPA boots against the local API, every
// route renders real seeded content, and the running app never talks to a
// host other than the local server.
//
//   npm run seed && npm run prod        # server on :8787
//   node scripts/boot-smoke.mjs         # -> evidence/phase1/
//
// Exits non-zero on any page error, console error, blank render, or any
// request to an origin other than the local server.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Later phases re-run this to prove the SPA still boots without overwriting
// the evidence an earlier phase was accepted on — which is exactly why the
// fallback is `scratch` and not `phase1`. It WAS phase1 for four phases, and
// on 2026-08-16 a bare `node scripts/boot-smoke.mjs` during Phase 5B rewrote
// twelve committed Phase 1 screenshots with Phase 5B's app. Same trap
// `playwright.config.ts` and `e2e/fixtures.ts` were caught in one level down;
// evidence/scratch/ is gitignored, and every phase script names its own.
const OUT = process.env.COSIGN_EVIDENCE_DIR
  ? join(APP_ROOT, "..", "..", "evidence", process.env.COSIGN_EVIDENCE_DIR)
  : join(APP_ROOT, "..", "..", "evidence", "scratch", "spa");
const BASE = process.env.COSIGN_BASE ?? "http://localhost:8787";
const ORIGIN = new URL(BASE).origin;

// `title` is the document title this route must end up with. The SPA is one
// document, so index.html can only name the app — for four phases every one
// of these routes therefore said "Cosign", which is what a tab, a history
// entry, a bookmark and a screen reader's first announcement all read.
// src/lib/title.ts fixed it; this is the check that it stays fixed, and it
// is behavioural rather than static: it reads document.title off the running
// page, after the data the title is made of has arrived.
const ROUTES = [
  // Logged out at "/" the switcher renders and Home never mounts, so the
  // bare app name is the correct answer here — and the same answer Home
  // itself gives, deliberately.
  { name: "01-switcher-logged-out", path: "/", auth: false, expect: /cosign|pick|start/i, title: /^Cosign$/ },
  // stub signup must work with no session at all — it is the signup surface
  { name: "01b-onboarding-logged-out", path: "/onboarding", auth: false, expect: /make your profile/i, needs: ["#ob-name", "#ob-username"], title: /^Start your list — Cosign$/ },
  { name: "01c-onboarding-signed-in", path: "/onboarding", auth: true, expect: /anywhere you already trust/i, title: /^Start your list — Cosign$/ },
  { name: "02-home", path: "/", auth: true, expect: /near me, open now, has outlets/i, title: /^Cosign$/ },
  { name: "02b-search", path: "/search", auth: true, expect: /what are you after/i, needs: ["#place-search"], title: /^Search — Cosign$/ },
  { name: "03-profile", path: "/maya", auth: true, expect: /maya/i, title: /^Maya Okafor — Cosign$/ },
  { name: "04-shop-detail", path: "/shop/oval-grounds", auth: true, expect: /oval grounds/i, title: /^Oval Grounds — Cosign$/ },
  { name: "05-shop-detail-logged-out", path: "/shop/oval-grounds", auth: false, expect: /oval grounds/i, title: /^Oval Grounds — Cosign$/ },
  { name: "06-list-detail", path: "/lists/l_our-campus-ranking", auth: true, expect: /./, title: /^our ranking of campus coffee — Cosign$/ },
  { name: "07-ranking-flow", path: "/rank", auth: true, expect: /./, title: /^Your list — Cosign$/ },
  { name: "08-group-new", path: "/group/new", auth: true, expect: /./, title: /^Ask three people — Cosign$/ },
  // A table is a link. This one does not exist, which is the state a link
  // reaches after the evening it was for — it must say so rather than boot
  // into an empty session.
  {
    name: "08b-group",
    path: "/g/g_notatable0000",
    auth: false,
    expect: /doesn't open anything/,
    title: /^Nothing at this address — Cosign$/,
    allowConsole: /404 \(Not Found\)/,
  },
  { name: "09-not-found", path: "/shop/there-is-no-such-place/x", auth: true, expect: /no page here/i, title: /^Nothing at this address — Cosign$/ },
];

const failures = [];
const offOrigin = new Set();
const report = [];
const titles = [];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

// Sign in once through the real endpoint so the cookie is server-issued.
const api = await browser.newContext({ baseURL: BASE });
const switched = await api.request.post("/api/auth/switch", { data: { userId: "u_maya" } });
if (!switched.ok()) {
  console.error(`auth/switch failed: ${switched.status()}`);
  process.exit(1);
}
const cookies = await api.storageState();

for (const route of ROUTES) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    storageState: route.auth ? cookies : undefined,
  });
  const page = await ctx.newPage();
  const errors = [];

  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // A designed "this link opens nothing" state is REACHED by a 404, and
    // the browser logs every non-2xx response whatever the page does about
    // it. `allowConsole` names the one route where that is the point.
    if (m.type() !== "error") return;
    if (route.allowConsole?.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (!url.startsWith(ORIGIN)) offOrigin.add(url);
  });
  page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`));

  await page.goto(route.path, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  if (text.length < 40) errors.push(`blank render (${text.length} chars of text)`);
  if (route.expect && !route.expect.test(text)) {
    errors.push(`expected ${route.expect} in page text, got: ${text.slice(0, 200)}`);
  }
  for (const sel of route.needs ?? []) {
    if ((await page.locator(sel).count()) === 0) errors.push(`missing element ${sel}`);
  }

  // A title made of fetched data lands one tick after the data does, so wait
  // for it rather than sampling — then read whatever is actually there and
  // report it, so a timeout shows up as the wrong title and not as a hang.
  if (route.title) {
    await page
      .waitForFunction((src) => new RegExp(src).test(document.title), route.title.source, { timeout: 5000 })
      .catch(() => {});
  }
  const title = await page.title();
  titles.push({ route: route.path, title });
  if (route.title && !route.title.test(title)) {
    errors.push(`title: expected ${route.title}, got ${JSON.stringify(title)}`);
  }

  await page.screenshot({ path: join(OUT, `${route.name}.png`), fullPage: true });

  report.push({ route: route.path, auth: route.auth, chars: text.length, title, errors });
  if (errors.length) failures.push({ route: route.name, errors });
  console.log(
    `${errors.length ? "FAIL" : "ok  "}  ${route.auth ? "auth" : "anon"}  ${route.path}  (${text.length} chars)` +
      (errors.length ? `\n      ${errors.join("\n      ")}` : ""),
  );
  await ctx.close();
}

await browser.close();

if (offOrigin.size) {
  console.log(`\nFAIL  ${offOrigin.size} request(s) to an origin other than ${ORIGIN}:`);
  for (const u of offOrigin) console.log(`      ${u}`);
} else {
  console.log(`\nok    every request stayed on ${ORIGIN} (zero external services)`);
}

// The gap this closes was not "a title is wrong", it was "there is one title
// for the whole app", so the count is worth stating on its own.
const distinct = new Set(titles.map((t) => t.title));
const oneTitleForEverything = distinct.size <= 1;
console.log(`\n${oneTitleForEverything ? "FAIL" : "ok  "}  ${distinct.size} distinct <title> across ${titles.length} routes:`);
for (const t of titles) console.log(`      ${t.route.padEnd(38)} ${t.title}`);

writeFileSync(
  join(OUT, "boot-smoke.json"),
  JSON.stringify(
    { base: BASE, routes: report, titles, distinctTitles: distinct.size, offOriginRequests: [...offOrigin] },
    null,
    2,
  ),
);

const failed = failures.length > 0 || offOrigin.size > 0 || oneTitleForEverything;
console.log(failed ? `\n${failures.length} route(s) failed` : `\nall ${ROUTES.length} routes booted clean`);
process.exit(failed ? 1 : 0);
