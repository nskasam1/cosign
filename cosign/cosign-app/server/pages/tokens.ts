// The SSR pages inline `src/design/tokens.css` rather than linking it: a
// stylesheet request is render-blocking and costs a full round trip, which
// the 1.0 s LCP budget cannot afford. One token file, three consumers — the
// server never redefines a value the design system already names.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ROOT } from "../db/db.ts";

const TOKENS_PATH = join(APP_ROOT, "src", "design", "tokens.css");
const PROD = process.env.NODE_ENV === "production" || process.argv.includes("--prod");

let cached: string | null = null;

export function tokensCss(): string {
  if (cached && PROD) return cached;
  cached = minifyCss(readFileSync(TOKENS_PATH, "utf-8"));
  return cached;
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
