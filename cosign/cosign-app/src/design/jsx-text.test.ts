// @vitest-environment node
//
// A `\uXXXX` escape inside JSX *text* is not an escape. It is six characters.
//
// In a string literal — `"That’s me"` — JavaScript resolves it and the
// apostrophe is real. In JSX text between tags, nothing resolves it, so
// `Dev build · look around` renders exactly like that on screen. Phase 9
// shipped one to the front door, under `.cs-caps`, which uppercases it: the
// first surface a stranger sees said **DEV BUILD \U00B7 LOOK AROUND AS
// SOMEBODY**.
//
// Nothing caught it. Typecheck is happy (it is valid text), lint is happy, the
// e2e assert on `[data-*]` hooks rather than prose, and the measured UI audit
// checks contrast and tap targets and has no opinion about spelling. It took
// looking at a screenshot.
//
// So: scan the JSX text of every component for escape sequences that only mean
// something inside quotes. Cheap, and it closes the whole class rather than the
// one instance.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(import.meta.dirname, "..", "..");
const SRC = join(APP, "src");

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx$/.test(p) && !/\.test\./.test(p)) yield p;
  }
}

/**
 * Strip everything where an escape IS meaningful: string literals, template
 * literals, and comments. What is left is JSX text and attribute-free markup —
 * the places a backslash is just a backslash.
 */
function jsxTextOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:[^`\\]|\\.)*`/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " ");
}

const ESCAPES = /\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|n|t)/;

describe("JSX text contains no escape sequences that will render literally", () => {
  const files = [...walk(SRC)];

  it("finds components to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => relative(APP, f)))("%s", (rel) => {
    const text = jsxTextOnly(readFileSync(join(APP, rel), "utf-8"));
    const hit = text.match(ESCAPES);
    expect(
      hit,
      hit
        ? `"${hit[0]}" appears in JSX text and will render as those characters. ` +
          `Use the character itself, or move it into a string literal.`
        : "",
    ).toBeNull();
  });

  it("the scanner can actually see one", () => {
    // Proven rather than assumed: the stripper is doing most of the work here,
    // and a stripper that removed too much would pass everything forever.
    const damaged = `const A = () => <p>Dev build \\u00b7 look around</p>;`;
    expect(ESCAPES.test(jsxTextOnly(damaged))).toBe(true);
    // ...and does not fire on the legitimate form.
    const fine = `const B = () => <p>{ok ? "That\\u2019s me" : "no"}</p>;`;
    expect(ESCAPES.test(jsxTextOnly(fine))).toBe(false);
  });
});
