// The codepoints the committed faces must carry, and the one place that set is
// written down.
//
// The three faces are committed files, not a dependency (CLAUDE.md), and they
// are subset by `scripts/subset-fonts.mjs`. A subset is a promise about what the
// product can put on screen, so the promise has to be explicit and testable
// rather than "whatever the seed happened to contain": the seed is replaceable,
// and every public surface renders text a person typed — a display name, a taste
// line, the one honest sentence under a place.
//
// So the set is a floor, not a census:
//
//   * Basic Latin, the whole printable block.
//   * Latin-1 Supplement, for café / naïve / Zoë and for the £ € the price
//     fields could carry.
//   * Latin Extended-A, because a student roll at any university contains
//     Łukasz, Šárka and Nguyễn — these are almost all composites of glyphs
//     already present, so they cost outlines the font mostly already has.
//   * Every non-ASCII character this repo actually emits, scanned out of the
//     source rather than remembered (see `emittedCodepoints`).
//
// What it deliberately does NOT promise: Cyrillic, Greek, CJK, or the emoji
// planes. None of the three faces ships them today either, so a subset cannot
// regress that — `fonts.test.ts` asserts the coverage claim against the files
// on disk, so the day somebody needs one the test says where to add it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const APP = dirname(dirname(fileURLToPath(import.meta.url)));

const range = (lo, hi) => {
  const out = [];
  for (let c = lo; c <= hi; c++) out.push(c);
  return out;
};

/** Blocks promised whether or not anything in the tree uses them today. */
export const PROMISED_BLOCKS = [
  ["Basic Latin", 0x0020, 0x007e],
  ["Latin-1 Supplement", 0x00a0, 0x00ff],
  ["Latin Extended-A", 0x0100, 0x017f],
];

/** Directories whose text can reach a rendered surface. */
const SCAN_DIRS = ["src", "server", "seed"];
const SCAN_EXT = new Set([".ts", ".tsx", ".css", ".json", ".html", ".md"]);
const SKIP_DIRS = new Set(["node_modules", "data", "dist", "images", "fonts", "takeout"]);

/**
 * Test files are NOT scanned, and the first version of this scanner proved why.
 * `src/design/no-scales.test.ts` holds the glyph blocklist the whole product is
 * built around — ★ ☆ ⭐ 👍 👎 — so scanning it promised the fonts would carry
 * exactly the five marks hard rule 2 says may never appear on a surface. Same
 * class of mistake as `lastIndexOf("/*")` finding the one inside `"/img/*"`: a
 * scanner that reads source as if it were output.
 */
const isTest = (p) => /\.test\.[tj]sx?$/.test(p);

/** Never promised, and asserted absent: the rating-scale glyphs of hard rule 2. */
export const BANNED = [0x2605, 0x2606, 0x2b50, 0x1f44d, 0x1f44e];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (SCAN_EXT.has(extname(name))) yield p;
  }
}

/**
 * Every non-ASCII codepoint that appears as a literal anywhere the product
 * could render it. Scanned, never listed by hand: the em dash, the curly
 * quotes `smart()` produces, the `≤` in the log flow's budget copy and the `·`
 * that separates half the metadata lines in this design all arrived in the tree
 * at different times, and a remembered list would have missed at least one.
 */
export function emittedCodepoints() {
  const found = new Map();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(APP, dir))) {
      if (isTest(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (cp < 0x80) continue;
        if (!found.has(cp)) found.set(cp, file);
      }
    }
  }
  return found;
}

/** The full required set, as sorted codepoints. */
export function requiredCodepoints() {
  const set = new Set();
  for (const [, lo, hi] of PROMISED_BLOCKS) for (const c of range(lo, hi)) set.add(c);
  for (const cp of emittedCodepoints().keys()) set.add(cp);
  for (const cp of BANNED) set.delete(cp);
  return [...set].sort((a, b) => a - b);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  const emitted = emittedCodepoints();
  const beyond = [...emitted.keys()].filter((cp) => cp > 0x017f).sort((a, b) => a - b);
  console.log(`required codepoints: ${requiredCodepoints().length}`);
  console.log(`non-ASCII literals found in the tree: ${emitted.size}`);
  console.log(`  of those, beyond Latin Extended-A: ${beyond.length}`);
  for (const cp of beyond) {
    const hex = cp.toString(16).toUpperCase().padStart(4, "0");
    console.log(`    U+${hex}  ${String.fromCodePoint(cp)}   first seen: ${emitted.get(cp).slice(APP.length + 1)}`);
  }
}
