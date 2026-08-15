// Phase 2 / 5A perf gate. Lighthouse mobile + simulated Slow-4G against the
// real production server (`npm run prod` on :8787) — never `vite preview`,
// which skips SSR and measures the wrong page.
//
//   npm run prod                                  # in another shell
//   node scripts/lighthouse.mjs /s/<token> phase2 # -> evidence/phase2/
//
// Exits non-zero if the gate is not met, so it can't be "passed" by claim.

import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = process.argv[2] ?? "/";
if (!path.startsWith("/")) {
  // Git Bash rewrites leading-slash arguments into Windows paths; the result
  // fails deep inside Lighthouse as an unhelpful INVALID_URL.
  console.error(`Path must start with "/" — got ${JSON.stringify(path)}.`);
  console.error(`Under Git Bash, prefix the command with MSYS_NO_PATHCONV=1.`);
  process.exit(2);
}
const phase = process.argv[3] ?? "phase2";
const label = process.argv[4] ?? "share";
const BASE = process.env.COSIGN_BASE ?? "http://localhost:8787";
const OUT = join(APP_ROOT, "..", "..", "evidence", phase);
const RUNS = Number(process.env.LH_RUNS ?? 3);

// Gate (PLAN.md, Phase 2): LCP <= 1.0 s and performance score >= 90.
const GATE = { lcpMs: 1000, perf: 90, a11y: 95 };

// Lighthouse's own mobileSlow4G preset, pinned here so the numbers in
// evidence/ are reproducible instead of tracking whatever the default is.
const throttling = {
  rttMs: 150,
  throughputKbps: 1638.4,
  requestLatencyMs: 150 * 3.75,
  downloadThroughputKbps: 1638.4 * 0.9,
  uploadThroughputKbps: 675 * 0.9,
  cpuSlowdownMultiplier: 4,
};

mkdirSync(OUT, { recursive: true });

const chrome = await launch({ chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"] });
const runs = [];
let last;

try {
  for (let i = 0; i < RUNS; i++) {
    const result = await lighthouse(
      `${BASE}${path}`,
      { port: chrome.port, output: "json", logLevel: "error" },
      {
        extends: "lighthouse:default",
        settings: {
          formFactor: "mobile",
          throttlingMethod: "simulate",
          throttling,
          screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 2, disabled: false },
          emulatedUserAgentString: false,
          onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        },
      },
    );
    last = result;
    const a = result.lhr.audits;
    runs.push({
      run: i + 1,
      perf: Math.round(result.lhr.categories.performance.score * 100),
      a11y: Math.round(result.lhr.categories.accessibility.score * 100),
      bestPractices: Math.round(result.lhr.categories["best-practices"].score * 100),
      seo: Math.round(result.lhr.categories.seo.score * 100),
      lcpMs: Math.round(a["largest-contentful-paint"].numericValue),
      fcpMs: Math.round(a["first-contentful-paint"].numericValue),
      tbtMs: Math.round(a["total-blocking-time"].numericValue),
      cls: Number(a["cumulative-layout-shift"].numericValue.toFixed(4)),
      siMs: Math.round(a["speed-index"].numericValue),
      ttfbMs: Math.round(a["server-response-time"]?.numericValue ?? 0),
      bytes: Math.round(a["total-byte-weight"]?.numericValue ?? 0),
    });
  }
} finally {
  // chrome-launcher rm -rf's its temp profile on kill; on Windows the
  // handles are often still held and it throws EPERM. The measurement is
  // already done at that point, so a failed temp cleanup must not fail the
  // gate — it would look exactly like a perf regression.
  try {
    await chrome.kill();
  } catch (err) {
    console.warn(`  (chrome temp cleanup failed, ignoring: ${err.code ?? err.message})`);
  }
}

// Report the median run: one lucky run is not a gate.
const med = (key) => {
  const v = runs.map((r) => r[key]).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};
const median = Object.fromEntries(Object.keys(runs[0]).filter((k) => k !== "run").map((k) => [k, med(k)]));

const lcpEl = last.lhr.audits["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node?.snippet;
const report = {
  url: `${BASE}${path}`,
  label,
  lighthouse: last.lhr.lighthouseVersion,
  throttling,
  gate: GATE,
  runs,
  median,
  lcpElement: lcpEl ?? null,
  passed: median.lcpMs <= GATE.lcpMs && median.perf >= GATE.perf,
  a11yPassed: median.a11y >= GATE.a11y,
  generatedAt: new Date().toISOString(),
};

writeFileSync(join(OUT, `lighthouse-${label}.json`), JSON.stringify(report, null, 2));
writeFileSync(join(OUT, `lighthouse-${label}.report.json`), JSON.stringify(last.lhr));

const line = (k, v, ok) => `  ${ok === undefined ? " " : ok ? "PASS" : "FAIL"}  ${k.padEnd(22)} ${v}`;
console.log(`\nLighthouse ${last.lhr.lighthouseVersion} · mobile · simulated Slow-4G · median of ${RUNS}`);
console.log(`  ${report.url}`);
console.log(line("performance", `${median.perf}`, median.perf >= GATE.perf));
console.log(line("LCP", `${median.lcpMs} ms`, median.lcpMs <= GATE.lcpMs));
console.log(line("accessibility", `${median.a11y}`, median.a11y >= GATE.a11y));
console.log(line("FCP", `${median.fcpMs} ms`));
console.log(line("Speed Index", `${median.siMs} ms`));
console.log(line("TBT", `${median.tbtMs} ms`));
console.log(line("CLS", `${median.cls}`));
console.log(line("total bytes", `${(median.bytes / 1024).toFixed(1)} kB`));
console.log(line("best-practices / seo", `${median.bestPractices} / ${median.seo}`));
if (lcpEl) console.log(`\n  LCP element: ${lcpEl.slice(0, 120)}`);
console.log(`\n  runs: ${runs.map((r) => `${r.perf}/${r.lcpMs}ms`).join("  ")}`);
console.log(`  -> evidence/${phase}/lighthouse-${label}.json`);

process.exit(report.passed ? 0 : 1);
