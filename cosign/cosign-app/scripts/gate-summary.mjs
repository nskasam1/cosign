// Reads the four Lighthouse runs the closing pass takes — each public page
// with its fonts and with `*/fonts/*` blocked — and prints what they show.
//
//   node scripts/gate-summary.mjs phase6
//
// Everything here is DERIVED. An evidence script that ends in a hard-written
// conclusion is a claim that goes stale the next time the numbers move, which
// is precisely the failure this pass spent its day removing: the first run of
// phase6-evidence.sh ended with "the spread collapses" printed underneath a
// control whose spread was 212 ms. So the only prose below is prose the
// numbers cannot contradict.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const phase = process.argv[2] ?? "phase6";
const dir = join(APP_ROOT, "..", "..", "evidence", phase);

const read = (label) => {
  const j = JSON.parse(readFileSync(join(dir, `lighthouse-${label}.json`), "utf-8"));
  const runs = j.runs.map((r) => r.lcpMs).sort((a, b) => a - b);
  return { median: j.median.lcpMs, runs, lo: runs[0], hi: runs[runs.length - 1], budget: j.gate.lcpMs };
};

const pages = [
  { name: "the ranked list  /s/", with: read("share"), without: read("share-no-fonts") },
  { name: "the profile      /p/", with: read("profile"), without: read("profile-no-fonts") },
];
const budget = pages[0].with.budget;

const ms = (n) => `${String(n).padStart(4)} ms`;
console.log(`\nLCP, median of 5, mobile + simulated Slow-4G. Budget ${budget} ms.\n`);
console.log(`  ${"".padEnd(20)}  ${"as served".padEnd(11)} ${"fonts blocked".padEnd(15)} spread (blocked)`);
for (const p of pages) {
  console.log(
    `  ${p.name}  ${ms(p.with.median)}${p.with.median <= budget ? " ok " : " OVER"}  ` +
      `${ms(p.without.median)}${p.without.median <= budget ? " ok " : " OVER"}    ` +
      `${p.without.lo}–${p.without.hi} ms`,
  );
}

console.log();
for (const p of pages) {
  const cost = p.with.median - p.without.median;
  const room = budget - p.without.median;
  if (cost <= 0) {
    // Blocking a request does not only remove its bytes: the text lays out in
    // fallback metrics, which can move the LCP element. Where the blocked run
    // is the SLOWER of the two, it is not measuring a floor and must not be
    // read as one.
    console.log(
      `  ${p.name.trim()}: blocking the fonts made it ${-cost} ms SLOWER, so this control is not a ` +
        `floor for this page — read it as a diagnostic, not as a second gate.`,
    );
    continue;
  }
  console.log(
    `  ${p.name.trim()}: the three faces cost ${cost} ms of simulated LCP, and the page with none of ` +
      `them on the wire measures ${p.without.median} ms — ${room >= 0 ? `${room} ms inside` : `${-room} ms past`} ` +
      `the budget. No change to the page goes under that figure.`,
  );
}
