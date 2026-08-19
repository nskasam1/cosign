// @vitest-environment node
//
// Every pressable shape in the `cs-*` vocabulary must have a disabled state.
//
// This exists because `.cs-pill` had one from Phase 3 and `.cs-pill-ghost`,
// `.cs-word` and `.cs-chip` did not, for six phases, and nothing noticed until
// Phase 9's onboarding put a `disabled` `.cs-word` on screen and a measured
// audit found it rendering exactly like an enabled one. A control that looks
// pressable and does nothing is worse than a missing control: the person keeps
// pressing it and concludes the product is broken.
//
// It is written the way `no-scales` and `motion` are — read the stylesheet,
// find the rule, fail the suite if it is not there — so the next shape somebody
// adds to the vocabulary cannot quietly arrive without one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(import.meta.dirname, "..", "..");
const css = readFileSync(join(APP, "src", "index.css"), "utf-8");

/** Strip comments so a class named in prose is not mistaken for a rule. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The pressable shapes. `.cs-row` and `.cs-tab` are deliberately absent: a row
 * and a tab are links to somewhere, and this product has no disabled
 * destinations — a place you cannot go is not shown at all.
 */
const PRESSABLE = ["cs-pill", "cs-pill-ghost", "cs-word", "cs-chip"];

describe("every pressable shape has a disabled state", () => {
  it.each(PRESSABLE)("%s is styled when disabled", (cls) => {
    const rule = new RegExp(`\\.${cls}\\[disabled\\]`);
    expect(rule.test(code), `.${cls}[disabled] has no rule in index.css`).toBe(true);
  });

  it("the disabled rule dims AND stops answering", () => {
    // Both halves matter. Opacity alone leaves a control that still fires;
    // pointer-events alone leaves one that looks available and is not.
    const block = code.match(/\.cs-pill\[disabled\][^{]*\{[^}]*\}/);
    expect(block, "could not find the .cs-pill[disabled] block").toBeTruthy();
    expect(block![0]).toMatch(/opacity:\s*0?\.\d+/);
    expect(block![0]).toMatch(/pointer-events:\s*none/);
  });

  it("names every pressable class in one rule, so they cannot drift apart", () => {
    // The failure this guards is not "no disabled state" but "four disabled
    // states that stopped agreeing" — which is how .cs-pill ended up alone.
    const block = code.match(/((?:\.cs-[a-z-]+\[disabled\],?\s*)+)\{[^}]*pointer-events:\s*none[^}]*\}/);
    expect(block, "no shared disabled rule found").toBeTruthy();
    for (const cls of PRESSABLE) {
      expect(block![1], `.${cls} is not in the shared disabled rule`).toContain(`.${cls}[disabled]`);
    }
  });
});
