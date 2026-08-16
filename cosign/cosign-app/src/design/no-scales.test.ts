// @vitest-environment node
//
// "No rating-scale input anywhere" is one of the brief's non-negotiables, and
// until now its only executable check lived in e2e/share.spec.ts — which sees
// exactly one SSR page. A slider added to an SPA screen shipped with every
// check green. This guard reads the source instead: every .ts/.tsx/.css under
// src/ and server/, on every test run.
//
// Patterns are deliberately narrow. `w-4/5`, `aspect-ratio:16/10` and
// `grid-column:1/-1` are innocent and must stay that way, so the numeric-score
// rules refuse a numerator that follows a word character, a dot, a colon, a
// slash or a hyphen — the shapes CSS and Tailwind fractions take. The
// scanner's own fixtures below prove it still catches the real thing.

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..");
const SELF = resolve(HERE, "no-scales.test.ts");

interface Rule {
  name: string;
  re: RegExp;
}

const RULES: Rule[] = [
  {
    name: "a range or number input (JSX or HTML)",
    re: /\btype\s*=\s*(?:["']|\{\s*["'`])(range|number)\b/i,
  },
  {
    name: "a scale role",
    re: /\brole\s*=\s*(?:["']|\{\s*["'`])(slider|progressbar|radiogroup)\b/i,
  },
  {
    name: "an aria value attribute (only scale widgets have one)",
    re: /\baria-value(now|min|max|text)\b/i,
  },
  {
    // The role rule above cannot see these: <progress> and <meter> carry
    // progressbar and meter *implicitly*, so a hand-rolled gauge would slip
    // past every other rule here and past a [role=...] DOM query in the e2e.
    name: "a native gauge element (its scale role is implicit)",
    re: /<\s*(progress|meter)[\s/>]/i,
  },
  {
    name: "an import of a scale-generating primitive",
    re: /from\s+["'](?:@\/components\/ui|(?:\.{1,2}\/)+(?:[\w.-]+\/)*ui|\.)\/(slider|progress|radio-group|chart)["']/,
  },
  {
    name: "an import of a scale-generating package",
    re: /from\s+["'](recharts|@radix-ui\/react-(?:slider|progress|radio-group))["']/,
  },
  {
    name: "a star or thumb glyph",
    // ★ ☆ ⭐ 👍 👎, written as escapes so the rule survives an encoding
    // round trip; the fixtures below feed it the literal glyphs
    re: /[\u{2605}\u{2606}\u{2B50}\u{1F44D}\u{1F44E}]/u,
  },
  {
    name: "a score out of five",
    re: /(?<![\w.:/-])[0-5](?:\.\d)?\s*(?:\/|\s+out of\s+)\s*5(?!\w|\.\d)/i,
  },
  {
    name: "a score out of ten",
    re: /(?<![\w.:/-])(?:10|\d(?:\.\d)?)\s*(?:\/|\s+out of\s+)\s*10(?!\w|\.\d)/i,
  },
];

interface Finding {
  file: string;
  line: number;
  rule: string;
  text: string;
}

/**
 * Prose about the ban is not the ban. A full-line comment is skipped, so
 * StatementRow.tsx can say in words why it refuses `role="radiogroup"` —
 * a comment renders nothing. A trailing comment does not buy amnesty, and
 * neither does closing a block comment and then writing markup.
 */
function isProse(line: string): boolean {
  return /^\s*(?:\/\/|\*|\/\*)/.test(line) && !/\*\/\s*\S/.test(line);
}

function scan(source: string, file: string): Finding[] {
  const found: Finding[] = [];
  source.split(/\r?\n/).forEach((line, i) => {
    if (isProse(line)) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        found.push({ file, line: i + 1, rule: rule.name, text: line.trim().slice(0, 120) });
      }
    }
  });
  return found;
}

/** Empty when clean; otherwise a `file:line` list you can jump straight to. */
function report(findings: Finding[]): string {
  return findings.map((f) => `${f.file}:${f.line} — ${f.rule}\n    ${f.text}`).join("\n");
}

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) sources(path, out);
    } else if (/\.(ts|tsx|css)$/.test(name) && resolve(path) !== SELF) {
      out.push(path);
    }
  }
  return out;
}

describe("the scanner itself", () => {
  it("catches every banned shape", () => {
    const violations = [
      '<input type="range" min={1} max={5} />',
      "<input type='number' />",
      '<input type={"number"} />',
      '<div role="slider" />',
      '<div role="progressbar" />',
      '<div role="radiogroup">',
      "<div aria-valuenow={3} aria-valuemin={1} aria-valuemax={5} />",
      '<div aria-valuetext="three of five" />',
      'import { Slider } from "@/components/ui/slider";',
      'import { Progress } from "./progress";',
      'import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";',
      'import { LineChart } from "recharts";',
      "<span>★★★☆☆</span>",
      "<span>\u{1F44D}</span>",
      "<p>Maya rated it 4.5/5</p>",
      "<p>She gave it 8 out of 10.</p>",
      '<input type="range" /> // just while I test it',
      '/* temporarily */ <input type="range" />',
      "<progress value={3} max={5} />",
      "<meter value={0.7}>70%</meter>",
    ];
    for (const line of violations) {
      expect({ line, hits: scan(line, "fixture").length }).toEqual({ line, hits: 1 });
    }
  });

  it("leaves innocent CSS, Tailwind fractions and unrelated roles alone", () => {
    const innocent = [
      '.lead .shot{aspect-ratio:16/10;grid-column:1/-1}',
      '<div className="w-4/5 basis-1/5 aspect-[16/10]" />',
      '<input type="text" inputMode="none" />',
      '<div role="radio" aria-checked={true} />',
      '<div role="progress-note" />',
      "const line = `${outlets} outlets, ${mbps} Mbps`;",
      ' * A plain button, never role="radiogroup" — that is the shape a rating',
      "// no <input type=\"range\"> anywhere, ever",
    ];
    expect(report(innocent.flatMap((line) => scan(line, "fixture")))).toBe("");
  });
});

describe("no rating-scale input anywhere", () => {
  const files = [...sources(join(APP, "src")), ...sources(join(APP, "server"))];

  it("scans the whole tree", () => {
    // a walk that silently found nothing would pass every check below
    expect(files.length).toBeGreaterThan(50);
  });

  it("finds no scale in any source file", () => {
    const findings = files.flatMap((f) =>
      scan(readFileSync(f, "utf-8"), relative(APP, f).replace(/\\/g, "/")),
    );
    expect(report(findings)).toBe("");
  });

  it("keeps the scale-generating primitives deleted", () => {
    // slider went in Phase 1; progress (role=progressbar), radio-group (a
    // five-item Likert in nine lines) and chart (recharts axes) in Phase 3.
    for (const name of ["slider", "progress", "radio-group", "chart"]) {
      const path = join(APP, "src", "components", "ui", `${name}.tsx`);
      expect({ [name]: existsSync(path) }).toEqual({ [name]: false });
    }
  });
});
