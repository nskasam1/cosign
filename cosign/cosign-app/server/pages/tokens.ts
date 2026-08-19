// The SSR pages inline `src/design/tokens.css` rather than linking it: a
// stylesheet request is render-blocking and costs a full round trip, which
// the 1.0 s LCP budget cannot afford. One token file, three consumers — the
// server never redefines a value the design system already names.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ROOT } from "../db/db.ts";

const TOKENS_PATH = join(APP_ROOT, "src", "design", "tokens.css");
const PROD = process.env.NODE_ENV === "production" || process.argv.includes("--prod");

let cached: { all: string; head: string; faces: string } | null = null;

function parts(): { all: string; head: string; faces: string } {
  if (cached && PROD) return cached;
  const raw = readFileSync(TOKENS_PATH, "utf-8");
  const at = raw.indexOf("@font-face");
  cached = {
    all: minifyCss(raw),
    head: minifyCss(at === -1 ? raw : raw.slice(0, at)),
    faces: minifyCss(at === -1 ? "" : raw.slice(at)),
  };
  return cached;
}

/**
 * The whole token file, or everything except the `@font-face` rules.
 *
 * `fonts: false` exists for a measured reason. A page whose first contentful
 * paint is TEXT gets that paint attributed, in Lighthouse's simulated graph,
 * to whatever font requests completed before it — and on localhost the fonts
 * land in about a millisecond, so they always do. The public profile paid
 * ~430 ms of simulated LCP for a font its text never waits on (`swap` means
 * the fallback paints immediately). Declaring the faces *after* the content,
 * with `fontFaceCss()`, makes the browser discover them after the first paint
 * — which is also what actually happens on a phone, and is why the share
 * page, whose first paint is an inlined photograph, never had the problem.
 */
export function tokensCss(opts: { fonts?: boolean } = {}): string {
  const p = parts();
  return opts.fonts === false ? p.head : p.all;
}

/** The three `@font-face` rules, to be declared after the content. */
export function fontFaceCss(): string {
  return parts().faces;
}

/**
 * Enough minification for an inline <style>, and no more. Spaces *inside*
 * declarations are load-bearing here — `--ink: 34 49% 91%` is three values,
 * not one — so only comments and the whitespace around structural
 * punctuation are removed.
 */
export function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};])\s*/g, "$1")
    .replace(/;\}/g, "}")
    .replace(/:\s+/g, ":")
    .replace(/\s*,\s*/g, ",")
    .trim();
}
