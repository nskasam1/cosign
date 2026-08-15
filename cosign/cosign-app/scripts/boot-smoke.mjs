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
const OUT = join(APP_ROOT, "..", "..", "evidence", "phase1");
const BASE = process.env.COSIGN_BASE ?? "http://localhost:8787";
const ORIGIN = new URL(BASE).origin;

const ROUTES = [
  { name: "01-switcher-logged-out", path: "/", auth: false, expect: /cosign|pick|start/i },
  // stub signup must work with no session at all — it is the signup surface
  { name: "01b-onboarding-logged-out", path: "/onboarding", auth: false, expect: /make your profile/i, needs: ["#ob-name", "#ob-username"] },
  { name: "01c-onboarding-signed-in", path: "/onboarding", auth: true, expect: /pick your spots/i },
  { name: "02-home", path: "/", auth: true, expect: /open now|near/i },
  { name: "03-profile", path: "/maya", auth: true, expect: /maya/i },
  { name: "04-shop-detail", path: "/shop/oval-grounds", auth: true, expect: /oval grounds/i },
  { name: "05-shop-detail-logged-out", path: "/shop/oval-grounds", auth: false, expect: /oval grounds/i },
  { name: "06-list-detail", path: "/lists/l_our-campus-ranking", auth: true, expect: /./ },
  { name: "07-ranking-flow", path: "/rank", auth: true, expect: /./ },
  { name: "08-group-new", path: "/group/new", auth: true, expect: /./ },
];

const failures = [];
const offOrigin = new Set();
const report = [];

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
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
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

  await page.screenshot({ path: join(OUT, `${route.name}.png`), fullPage: true });

  report.push({ route: route.path, auth: route.auth, chars: text.length, errors });
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

writeFileSync(
  join(OUT, "boot-smoke.json"),
  JSON.stringify({ base: BASE, routes: report, offOriginRequests: [...offOrigin] }, null, 2),
);

const failed = failures.length > 0 || offOrigin.size > 0;
console.log(failed ? `\n${failures.length} route(s) failed` : `\nall ${ROUTES.length} routes booted clean`);
process.exit(failed ? 1 : 0);
