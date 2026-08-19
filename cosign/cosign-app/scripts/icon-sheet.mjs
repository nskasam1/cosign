// Render every icon at three sizes onto one page, so they can be looked at.
//
//   node scripts/icon-sheet.mjs
//
// The icons are hand-authored path data. A typo in a path renders as
// convincing garbage — a shape that is clearly *an* icon, just not the one it
// claims to be — and it is completely invisible in a diff. This exists so that
// "I drew 24 icons" is a claim somebody can check in five seconds.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(APP, "..", "..", "evidence", process.env.COSIGN_EVIDENCE ?? "scratch/icons");
mkdirSync(OUT, { recursive: true });

// Read the paths straight out of the source rather than importing TS.
const src = readFileSync(join(APP, "src", "icons", "paths.ts"), "utf-8");
const body = src.slice(src.indexOf("export const PATHS"), src.indexOf("} as const;"));
const icons = [...body.matchAll(/^\s{2}([a-zA-Z]+):\s*\n?\s*"((?:[^"\\]|\\.)*)"/gm)].map((m) => ({
  name: m[1],
  d: m[2].replace(/\\n\s*/g, " "),
}));
// Multi-line entries use string concatenation across lines; catch those too.
const multi = [...body.matchAll(/^\s{2}([a-zA-Z]+):\s*\n\s*"((?:[^"\\]|\\.)*)"/gm)];
for (const m of multi) if (!icons.some((i) => i.name === m[1])) icons.push({ name: m[1], d: m[2] });

if (icons.length < 10) {
  console.error(`only parsed ${icons.length} icons — the extractor is wrong, not the set`);
  process.exit(1);
}

const cell = (i) => `
  <figure>
    <div class="row">
      ${[20, 24, 32]
        .map(
          (s) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none"
             stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
             stroke-linejoin="round"><path d="${i.d}"/></svg>`,
        )
        .join("")}
    </div>
    <figcaption>${i.name}</figcaption>
  </figure>`;

const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin:0; background:#120E0C; color:#F7EDE1;
         font:400 13px/1.4 ui-sans-serif,system-ui,sans-serif; padding:28px; }
  h1 { font-size:15px; letter-spacing:.12em; text-transform:uppercase;
       color:#DAB462; margin:0 0 22px; }
  .grid { display:grid; grid-template-columns:repeat(6,1fr); gap:22px 14px; }
  figure { margin:0; text-align:center; }
  .row { display:flex; align-items:flex-end; justify-content:center; gap:10px;
         background:#1D1815; border:1px solid #2E2621; border-radius:14px;
         padding:16px 8px; min-height:64px; }
  figcaption { margin-top:8px; font-size:11px; color:#A79A8B; }
</style>
<h1>Cosign icon set · ${icons.length} glyphs · 20 / 24 / 32 px</h1>
<div class="grid">${icons.map(cell).join("")}</div>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
await p.setContent(html);
await p.waitForTimeout(300);
await p.screenshot({ path: join(OUT, "icon-sheet.png"), fullPage: true });
await b.close();
console.log(`${icons.length} icons -> ${join(OUT, "icon-sheet.png")}`);
console.log(icons.map((i) => i.name).join(" "));
