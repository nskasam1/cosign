// Subset the three browser faces to the codepoints the product promises.
//
//   node scripts/subset-fonts.mjs            # report only, changes nothing
//   node scripts/subset-fonts.mjs --write    # rewrite public/fonts/*.woff2
//
// Only `public/fonts/*.woff2` is touched. `server/assets/fonts/*.woff` is left
// alone on purpose: satori converts its text to paths server-side, so those
// files are not on any page's critical path and cannot move the LCP gate — while
// a glyph missing from them silently drops a letter out of an OG card that gets
// posted to iMessage. Risk with no upside is not an optimisation.
//
// Needs fontTools + brotli, which are DEV tooling and deliberately not a repo
// dependency: `pip install --user fonttools brotli`. The rule the brief sets is
// zero external services at runtime — no keys, no CDNs, no remote host. A build
// tool that runs on a laptop and emits a committed file is the same category as
// playwright and lighthouse, and the fonts stay committed files either way.
// The script refuses rather than half-works if the toolchain is absent.
//
// RESULT, measured 2026-08-18 and NOT acted on:
//
//   young-serif-400   26.4 kB -> 23.0 kB
//   karla-400         12.8 kB -> 11.1 kB
//   karla-700         13.0 kB -> 11.2 kB
//   total             52.2 kB -> 45.3 kB   (-6.9 kB, -13%)
//
// PLAN.md's Phase 6 estimate was "best case ~33 kB against 54 kB, worth about
// 110 ms". That was 2.5x optimistic, and the reason is that these files were
// extracted from @fontsource ALREADY subset to Latin: they carry 227 and 220
// mapped codepoints, not the ~700 a full face would. There is very little left
// to remove.
//
// And what is left is not safe to remove. The 6.9 kB comes from dropping,
// among others, U+2018 LEFT SINGLE QUOTATION MARK, five combining accents
// (U+0300-U+0308), U+20AC EURO SIGN and U+2022 BULLET. `smart()` only ever
// emits U+2019, so a scan of the tree does not see U+2018 — but these two
// pages render text a PERSON typed, and a phone's own smart quotes produce the
// left one. Trading a visible glyph on a public page about a real person for
// 6.9 kB, on a budget whose own noise is 300 ms, is a bad trade in both
// directions. So this stays a measurement and `--write` stays unused.

import { execFileSync } from "node:child_process";
import { statSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredCodepoints } from "./font-coverage.mjs";

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const FONT_DIR = join(APP, "public", "fonts");
const FACES = ["young-serif-400.woff2", "karla-400.woff2", "karla-700.woff2"];

const write = process.argv.includes("--write");
const kb = (n) => (n / 1024).toFixed(1) + " kB";

function python(args) {
  return execFileSync("python", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

try {
  python(["-c", "import fontTools, brotli"]);
} catch {
  console.error("fontTools/brotli not available. `pip install --user fonttools brotli`");
  process.exit(1);
}

const cps = requiredCodepoints();
const unicodes = cps.map((c) => "U+" + c.toString(16).toUpperCase().padStart(4, "0")).join(",");

let before = 0;
let after = 0;
const rows = [];

for (const face of FACES) {
  const src = join(FONT_DIR, face);
  const out = join(FONT_DIR, face.replace(/\.woff2$/, ".subset.woff2"));
  const sizeBefore = statSync(src).size;

  python([
    "-m",
    "fontTools.subset",
    src,
    `--unicodes=${unicodes}`,
    "--flavor=woff2",
    `--output-file=${out}`,
    // Keep the shaping features this design actually uses. `--layout-features`
    // defaults to a conservative set that drops `tnum`, and tokens.css asks for
    // tabular figures on every column of numerals in the app.
    "--layout-features+=tnum,onum,liga,kern",
    "--name-IDs=*",
    "--notdef-outline",
    "--drop-tables+=DSIG",
  ]);

  const sizeAfter = statSync(out).size;
  before += sizeBefore;
  after += sizeAfter;
  rows.push([face, sizeBefore, sizeAfter]);

  if (write) copyFileSync(out, src);
  if (existsSync(out)) rmSync(out);
}

const glyphCount = (file) =>
  Number(
    python([
      "-c",
      "import sys;from fontTools.ttLib import TTFont;print(len(TTFont(sys.argv[1]).getGlyphOrder()))",
      file,
    ]).trim(),
  );

console.log(`required codepoints: ${cps.length}`);
for (const [face, b, a] of rows) {
  const pct = (((b - a) / b) * 100).toFixed(1);
  console.log(`  ${face.padEnd(24)} ${kb(b).padStart(9)} -> ${kb(a).padStart(9)}  (-${pct}%)`);
}
console.log(`  ${"total".padEnd(24)} ${kb(before).padStart(9)} -> ${kb(after).padStart(9)}  (-${kb(before - after)})`);
if (!write) console.log("\nreport only — pass --write to rewrite public/fonts/*.woff2");
else {
  console.log("\nwritten. glyphs now in each face:");
  for (const face of FACES) console.log(`  ${face.padEnd(24)} ${glyphCount(join(FONT_DIR, face))}`);
}
