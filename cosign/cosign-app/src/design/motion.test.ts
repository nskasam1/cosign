// @vitest-environment node
//
// "Subtle purposeful motion … prefers-reduced-motion" is one of the brief's
// design requirements for every UI phase, and it is the one that cannot be
// checked by looking at a screenshot: a screenshot of an animation is a
// screenshot of one of its frames. So it is checked here, on the source,
// every run — the same shape as no-scales.test.ts and no-bait.test.ts.
//
// Three things it enforces, and each one has already been broken once:
//
//   1. NO LITERAL TIME in an animation or transition. Reduced motion in this
//      product is implemented by zeroing four custom properties in
//      tokens.css, which means an animation that spells its own duration is
//      an animation nobody can turn off. `tailwind.config.ts` carried five
//      of them for six phases — 0.2s, 0.2s, 0.3s, 0.4s — under a comment
//      forbidding exactly that.
//   2. NOTHING REPEATS FOREVER. The fifth was `shimmer 2s linear infinite`.
//      CLAUDE.md records the same trap in `animate-spin`; a perpetual motion
//      is the one kind that a person with vestibular trouble cannot wait out.
//   3. EVERY SURFACE CAN STOP. All three stylesheets in the product — the
//      app's and the two public SSR pages, which share a vocabulary but not
//      a file — must carry the blanket reduced-motion rule, not a list of
//      the class names somebody remembered. The SPA guarded three class
//      names for four phases while everything else it mounted walked past.
//
// Plus the invariant that makes zeroed durations safe: a 0s animation still
// runs its keyframes, so every `animation` shorthand fills `both` and every
// keyframe ends at the resting state rather than starting there.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..");

const read = (...p: string[]) => readFileSync(join(APP, ...p), "utf-8");

/**
 * Everything that reaches a rendered pixel: the app's stylesheet, the two
 * hand-templated SSR pages (which share a vocabulary, not a file), and the
 * token file all three read.
 */
const SHEETS: Array<{ name: string; css: string }> = [
  { name: "src/index.css", css: read("src", "index.css") },
  { name: "src/design/tokens.css", css: read("src", "design", "tokens.css") },
  { name: "server/pages/shareList.ts", css: read("server", "pages", "shareList.ts") },
  { name: "server/pages/shareProfile.ts", css: read("server", "pages", "shareProfile.ts") },
];

/**
 * Every `animation` / `transition` declaration and its value, wherever it
 * appears — a real stylesheet, or a template literal inside a .ts file that
 * is inlined into an SSR page. Deliberately narrow: it looks only at the
 * value of the six properties that can carry a duration, so a `2s` written
 * in prose, a `w-4/5`, or an unrelated number is never a finding.
 */
const DECLARATION = /(?:^|[;{"'`\s])(animation|transition)(-duration|-delay)?\s*:\s*([^;}"'`\n]*)/g;

interface Finding {
  sheet: string;
  property: string;
  value: string;
  why: string;
}

/**
 * A time somebody typed. `.2s` counts — the leading-dot form is exactly how
 * a duration gets past a reader, and it got past the first draft of this
 * regex too, which is why the fixtures below feed it both shapes.
 */
const LITERAL_TIME = /(?<![\w-])(?:\d*\.)?\d+\s*m?s(?![\w-])/;

/** `none!important` and `none !important` are both `none`. */
const bare = (value: string) => value.replace(/!\s*important/g, "").trim();

/**
 * Comments are not code, and this scanner used to read them as code.
 *
 * The fixture below covered a comment containing a duration — but not one
 * containing a COLON, and the colon is what makes the declaration regex bite.
 * A block comment reading `animation: … infinite`, written to explain why the
 * skeletons are deliberately static, was reported as a real violation when the
 * card layer landed. Same family as the `lastIndexOf("/*")` finding in
 * CLAUDE.md: a source scanner has to strip what is not source first.
 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, " ");

function scan(name: string, rawCss: string): Finding[] {
  const css = stripComments(rawCss);
  const found: Finding[] = [];
  for (const [, prop, sub, raw] of css.matchAll(DECLARATION)) {
    const value = raw.trim();
    if (!value) continue;
    const property = `${prop}${sub ?? ""}`;
    if (LITERAL_TIME.test(value)) {
      found.push({ sheet: name, property, value, why: "a literal duration cannot be zeroed by tokens.css" });
    }
    if (/\binfinite\b/.test(value)) {
      found.push({ sheet: name, property, value, why: "nothing in this product may move forever" });
    }
    // `animation: none` is the reduced-motion escape and takes no fill mode.
    if (prop === "animation" && !sub && bare(value) !== "none" && !/\bboth\b/.test(value)) {
      found.push({ sheet: name, property, value, why: "a 0s animation still runs its keyframes — fill `both`" });
    }
  }
  return found;
}

const report = (f: Finding[]) =>
  f.map((x) => `${x.sheet} — ${x.property}: ${x.value}\n    ${x.why}`).join("\n");

describe("the scanner itself", () => {
  it("catches a duration a person cannot turn off, in both decimal shapes", () => {
    expect(scan("f", ".x{animation:cs-draw 320ms var(--ease-out) both}")).toHaveLength(1);
    expect(scan("f", ".x{transition:opacity 0.2s ease}")).toHaveLength(1);
    // the leading-dot form, which the first draft of LITERAL_TIME missed
    expect(scan("f", ".x{transition:opacity .2s ease}")).toHaveLength(1);
    expect(scan("f", ".x{animation-duration:2s}")).toHaveLength(1);
    expect(scan("f", ".x{animation-delay:40ms}")).toHaveLength(1);
  });

  it("catches a motion that never stops, even on a token", () => {
    const forever = scan("f", ".x{animation:spin var(--duration-slow) linear infinite both}");
    expect(forever.map((f) => f.why)).toContain("nothing in this product may move forever");
  });

  it("catches an animation that does not hold its end state", () => {
    const unfilled = scan("f", ".x{animation:cs-settle var(--duration-base) var(--ease-out)}");
    expect(unfilled).toHaveLength(1);
    expect(unfilled[0].why).toMatch(/fill `both`/);
  });

  it("leaves the honest declarations alone", () => {
    const clean = [
      ".x{animation:cs-draw var(--duration-slow) var(--ease-out) both}",
      ".x{animation-delay:calc(var(--i) * var(--stagger))}",
      ".x{transition:opacity var(--duration-fast) var(--ease-out),transform var(--duration-fast) var(--ease-out)}",
      "@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}",
      // the tokens themselves are the source of truth and are not declarations
      ":root{--duration-base:200ms;--stagger:40ms}",
    ].join("\n");
    expect(report(scan("f", clean))).toBe("");
  });

  it("reads the value of the property, not the whole line", () => {
    // a 2s in prose beside a clean declaration is not a finding
    const prose = "/* it used to be shimmer 2s linear infinite */\n.x{animation:a var(--duration-base) ease both}";
    expect(report(scan("f", prose))).toBe("");
  });

  it("ignores a comment that contains a whole fake declaration", () => {
    // What the fixture above missed: prose with a COLON in it parses as a
    // declaration. This is the exact comment that broke the suite when the
    // card layer landed, explaining why the skeletons are static.
    const commented = [
      ".a{color:red}",
      "/* A shimmer is `animation: 2s linear infinite`, which this test",
      "   fails the suite on, correctly. */",
      ".b{animation:x var(--duration-base) ease both}",
    ].join("\n");
    expect(report(scan("f", commented))).toBe("");
  });

  it("still bites on a real declaration that follows a comment", () => {
    // Stripping comments must not strip the code after them.
    const after = "/* explanation */\n.x{animation:spin var(--duration) linear infinite both}";
    expect(report(scan("f", after))).toMatch(/infinite/);
  });
});

describe("every animation in the product can be stopped", () => {
  it("is pointed at real files, all four of them", () => {
    // Without this the sweep below could pass on four empty strings.
    expect(SHEETS.map((s) => s.name)).toHaveLength(4);
    for (const s of SHEETS) expect(s.css.length, s.name).toBeGreaterThan(500);
    // and each really does declare motion, or there is nothing to check
    for (const s of SHEETS) expect(s.css, s.name).toMatch(/animation|transition|--duration-/);
  });

  it("no literal duration, nothing infinite, every animation filled", () => {
    expect(report(SHEETS.flatMap((s) => scan(s.name, s.css)))).toBe("");
  });

  it("tokens.css zeroes every duration token it defines", () => {
    const tokens = read("src", "design", "tokens.css");
    const defined = [...tokens.matchAll(/--(duration-[\w-]+|stagger)\s*:/g)].map((m) => m[1]);
    const unique = [...new Set(defined)];
    expect(unique.sort()).toEqual(["duration-base", "duration-fast", "duration-slow", "stagger"]);
    const reduced = tokens.slice(tokens.indexOf("prefers-reduced-motion"));
    for (const token of unique) {
      expect(reduced, `--${token} is never zeroed`).toMatch(new RegExp(`--${token}\\s*:\\s*0`));
    }
  });

  it("every stylesheet carries the BLANKET reduced-motion rule, not a class list", () => {
    // A named-class list only guards the classes somebody remembered to
    // name; the SPA had one for three phases while shadcn's own animations
    // and Tailwind's `animate-*` walked straight past it.
    for (const sheet of SHEETS) {
      if (sheet.name.endsWith("tokens.css")) continue; // tokens zero the values instead
      const block = sheet.css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^@]*/);
      expect(block, `${sheet.name} has no reduced-motion block`).toBeTruthy();
      expect(block![0], sheet.name).toMatch(/\*\s*,?/);
      expect(block![0], sheet.name).toMatch(/animation:\s*none\s*!important/);
      expect(block![0], sheet.name).toMatch(/transition:\s*none\s*!important/);
    }
  });

  it("tailwind ships no animation of its own, and no plugin that would", () => {
    // Prose about the ban is not the ban — the same carve-out no-scales and
    // no-bait make, and this test needed it on its first run: the config's
    // new comment explains which plugin was removed, by name.
    const config = read("tailwind.config.ts").replace(/^\s*\/\/.*$/gm, "");
    // `keyframes:` and `animation:` in the theme, and tailwindcss-animate,
    // are three doors to a duration the token file never named.
    expect(config).not.toMatch(/^\s*keyframes\s*:/m);
    expect(config).not.toMatch(/^\s*animation\s*:\s*\{/m);
    expect(config).not.toMatch(/tailwindcss-animate/);
    expect(config).toMatch(/plugins\s*:\s*\[\s*\]/);
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    // The two libraries whose whole job is to animate past the token file.
    for (const banned of ["tailwindcss-animate", "framer-motion"]) {
      expect({ [banned]: banned in pkg.dependencies }).toEqual({ [banned]: false });
    }
  });

  it("every keyframe ends at the resting state", () => {
    // Reduced motion renders the unanimated element. If a keyframe's `to`
    // were the moved state, stopping the animation would strand it there.
    const css = read("src", "index.css");
    for (const [, name, body] of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([^@]*?)\n\}/g)) {
      const to = body.match(/to\s*\{([^}]*)\}/);
      expect(to, `@keyframes ${name} has no \`to\``).toBeTruthy();
      expect(to![1], `@keyframes ${name} does not rest at the end`).toMatch(
        /transform:\s*(?:none|scaleX\(1\)|scaleY\(1\))|opacity:\s*1/,
      );
    }
  });
});
