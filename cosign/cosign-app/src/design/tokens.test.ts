// @vitest-environment node
//
// The token file is the design system's only source of truth, so it gets a
// test rather than a promise. Three things are checked:
//   1. every documented colour pair still clears its WCAG threshold,
//   2. the copies satori needs in server/pages/og.ts have not drifted,
//   3. every font the tokens name is actually committed to the repo.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..");
const css = readFileSync(join(HERE, "tokens.css"), "utf-8");

/** `--ink: 34 49% 91%` -> [34, 49, 91]; follows one level of `var()` alias. */
function token(name: string): [number, number, number] {
  const raw = css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
  if (!raw) throw new Error(`token --${name} is not defined`);
  const alias = raw.match(/^var\(--([\w-]+)\)$/);
  if (alias) return token(alias[1]);
  const m = raw.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) throw new Error(`token --${name} is not an H S% L% triple: ${raw}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const channel = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(a: string, b: string): number {
  const x = luminance(hslToRgb(token(a)));
  const y = luminance(hslToRgb(token(b)));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const hexToRgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/**
 * Tokens are stored as whole-number `H S% L%`, so a round trip back to hex
 * loses up to a unit per channel. Two colours "match" when every channel is
 * within that rounding error — enough to catch a real edit, not enough to
 * fail on the lossy conversion.
 */
function expectSameColour(hexValue: string | undefined, tokenName: string, label: string): void {
  expect(hexValue, `${label} is missing`).toBeTruthy();
  const got = hexToRgb(hexValue!);
  const want = hslToRgb(token(tokenName));
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(got[i] - want[i]), `${label} channel ${i} (${hexValue} vs --${tokenName})`).toBeLessThanOrEqual(2);
  }
}

describe("colour contrast (WCAG 2.1)", () => {
  // [foreground, background, minimum, what it is used for]
  const NORMAL_TEXT: Array<[string, string, string]> = [
    ["ink", "bg", "headlines and place names"],
    ["ink", "surface", "text on a raised surface"],
    ["line", "bg", "the honest line under every entry"],
    ["muted", "bg", "metadata and captions"],
    ["muted", "surface", "metadata on a chip"],
    ["gold", "bg", "small-caps labels and intent tags"],
    ["ember-ink", "bg", "the CTA link"],
    ["bg", "ember", "text on the active filter chip"],
    // The plate initials render at 25.6px, which axe treats as normal text
    // (large text starts at 24px *bold*), so they are held to 4.5 too.
    ["pal-warm", "plate-warm", "no-photo plate initials"],
    ["pal-amber", "plate-amber", "no-photo plate initials"],
    ["pal-rose", "plate-rose", "no-photo plate initials"],
    ["pal-moss", "plate-moss", "no-photo plate initials"],
    ["pal-slate", "plate-slate", "no-photo plate initials"],
    ["pal-clay", "plate-clay", "no-photo plate initials"],
  ];

  it.each(NORMAL_TEXT)("%s on %s clears 4.5:1 — %s", (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  const LARGE_TEXT: Array<[string, string, string]> = [
    ["ember", "bg", "rank numerals"],
    ["pal-warm", "bg", "rank numeral, warm places"],
    ["pal-amber", "bg", "rank numeral, amber places"],
    ["pal-rose", "bg", "rank numeral, rose places"],
    ["pal-moss", "bg", "rank numeral, moss places"],
    ["pal-slate", "bg", "rank numeral, slate places"],
    ["pal-clay", "bg", "rank numeral, clay places"],
  ];

  it.each(LARGE_TEXT)("%s on %s clears 3:1 — %s", (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it("keeps the two accents distinguishable from each other", () => {
    // ember and gold carry different meanings; if they converge the system
    // stops meaning anything.
    expect(contrast("ember", "gold")).toBeGreaterThan(1.4);
  });
});

describe("no value is defined twice", () => {
  it("the OG renderer's colour copies still match the token file", () => {
    // satori has no CSS custom properties, so server/pages/og.ts repeats a
    // handful of hex values. This is the guard on that duplication.
    const og = readFileSync(join(APP, "server", "pages", "og.ts"), "utf-8");
    const pick = (key: string) => og.match(new RegExp(`\\b${key}:\\s*"(#[0-9a-fA-F]{6})"`))?.[1]?.toLowerCase();
    const pairs: Array<[string, string]> = [
      ["bg", "bg"],
      ["surface", "surface"],
      ["ink", "ink"],
      ["line", "line"],
      ["muted", "muted"],
      ["rule", "rule"],
      ["ember", "ember"],
      ["gold", "gold"],
    ];
    for (const [ogKey, tokenName] of pairs) {
      expectSameColour(pick(ogKey), tokenName, `og.ts ${ogKey}`);
    }
    expectSameColour(pick("ruleStrong"), "rule-strong", "og.ts ruleStrong");
  });

  it("the OG renderer's place palettes still match the token file", () => {
    const og = readFileSync(join(APP, "server", "pages", "og.ts"), "utf-8");
    for (const name of ["warm", "amber", "rose", "moss", "slate", "clay"]) {
      const value = og.match(new RegExp(`\\b${name}:\\s*"(#[0-9a-fA-F]{6})"`))?.[1]?.toLowerCase();
      expectSameColour(value, `pal-${name}`, `og.ts palette ${name}`);
    }
  });

  it("every browser-chrome colour is the token ground", () => {
    // The status bar, the splash screen and the installed app's window are
    // painted by the OS from these three files, not by any stylesheet — so
    // they are the one other place a colour has to be written out by hand.
    // They said #141618 (the pre-token palette) for four phases while every
    // page behind them was #14100E, which is a visibly cooler grey butting
    // against a warm page on the one surface CSS cannot reach.
    const html = readFileSync(join(APP, "index.html"), "utf-8");
    expectSameColour(
      html.match(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})"/)?.[1]?.toLowerCase(),
      "bg",
      "index.html theme-color",
    );

    const manifest = JSON.parse(readFileSync(join(APP, "public", "manifest.json"), "utf-8")) as {
      background_color?: string;
      theme_color?: string;
    };
    expectSameColour(manifest.theme_color?.toLowerCase(), "bg", "manifest theme_color");
    expectSameColour(manifest.background_color?.toLowerCase(), "bg", "manifest background_color");

    // The SSR pages inline the tokens, but their <meta> tag is read before a
    // stylesheet is, so it is hand-written there too — both of them.
    const share = readFileSync(join(APP, "server", "pages", "shareList.ts"), "utf-8");
    const metas = [...share.matchAll(/theme-color" content="(#[0-9a-fA-F]{6})"/g)].map((m) =>
      m[1].toLowerCase(),
    );
    expect(metas.length, "shareList.ts theme-color tags (page + tombstone)").toBe(2);
    for (const [i, hex] of metas.entries()) expectSameColour(hex, "bg", `shareList.ts theme-color #${i + 1}`);
  });
});

describe("fonts", () => {
  const faces = [...css.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map((m) => m[1]);

  it("declares exactly the committed faces", () => {
    expect(faces.length).toBe(3);
  });

  it.each(faces)("%s is committed to public/", (path) => {
    expect(existsSync(join(APP, "public", path.replace(/^\//, "")))).toBe(true);
  });

  it("ships the .woff duplicates the OG renderer needs", () => {
    for (const f of ["young-serif-400.woff", "karla-400.woff", "karla-700.woff"]) {
      expect(existsSync(join(APP, "server", "assets", "fonts", f)), f).toBe(true);
    }
  });

  it("never names a family it does not ship", () => {
    // The whole point of self-hosting: no CDN, and no font stack that quietly
    // relies on a face only some machines have.
    expect(css).toMatch(/--font-display:\s*"Young Serif"/);
    expect(css).toMatch(/--font-body:\s*Karla\b/);
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import url\(http/);
  });

  it("uses font-display: swap on every face", () => {
    const declarations = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(declarations.length).toBe(3);
    for (const d of declarations) expect(d).toMatch(/font-display:\s*swap/);
  });
});

describe("motion", () => {
  it("zeroes every duration under prefers-reduced-motion", () => {
    const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    for (const d of ["--duration-fast", "--duration-base", "--duration-slow"]) {
      expect(block, d).toMatch(new RegExp(`${d}:\\s*0ms`));
    }
  });
});
