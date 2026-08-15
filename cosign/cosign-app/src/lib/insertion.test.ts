// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applyComparison,
  finalIndex,
  finalList,
  isDone,
  nextOpponent,
  replayInsertion,
  startInsertion,
} from "./insertion";

/** Drive an insertion using a ground-truth order to answer comparisons. */
function insertWithOracle(candidate: string, list: string[], truth: string[]) {
  let state = startInsertion(candidate, list);
  let taps = 0;
  while (!isDone(state)) {
    const opp = nextOpponent(state)!;
    state = applyComparison(state, truth.indexOf(candidate) < truth.indexOf(opp));
    taps++;
  }
  return { state, taps };
}

describe("binary-search insertion", () => {
  it("places into an empty list with zero comparisons", () => {
    const state = startInsertion("a", []);
    expect(isDone(state)).toBe(true);
    expect(nextOpponent(state)).toBeNull();
    expect(finalIndex(state)).toBe(0);
    expect(finalList(state)).toEqual(["a"]);
  });

  it("inserts at the head (new favorite)", () => {
    const truth = ["new", "a", "b", "c", "d"];
    const { state } = insertWithOracle("new", ["a", "b", "c", "d"], truth);
    expect(finalList(state)).toEqual(truth);
  });

  it("inserts in the middle", () => {
    const truth = ["a", "b", "new", "c", "d"];
    const { state } = insertWithOracle("new", ["a", "b", "c", "d"], truth);
    expect(finalList(state)).toEqual(truth);
  });

  it("inserts at the tail (worst so far)", () => {
    const truth = ["a", "b", "c", "d", "new"];
    const { state } = insertWithOracle("new", ["a", "b", "c", "d"], truth);
    expect(finalList(state)).toEqual(truth);
  });

  it("never exceeds ceil(log2(n+1)) comparisons", () => {
    for (let n = 1; n <= 64; n++) {
      const list = Array.from({ length: n }, (_, i) => `s${i}`);
      for (const target of [0, Math.floor(n / 2), n]) {
        const truth = [...list.slice(0, target), "new", ...list.slice(target)];
        const { taps } = insertWithOracle("new", list, truth);
        expect(taps).toBeLessThanOrEqual(Math.ceil(Math.log2(n + 1)));
      }
    }
  });

  it("rejects a candidate already in the list", () => {
    expect(() => startInsertion("a", ["a", "b"])).toThrow();
  });

  it("replayInsertion reproduces every position and its comparisons agree", () => {
    const list = ["a", "b", "c", "d", "e"];
    for (let target = 0; target <= list.length; target++) {
      const { comparisons, list: result } = replayInsertion("new", list, target);
      expect(result.indexOf("new")).toBe(target);
      expect(comparisons.length).toBeLessThanOrEqual(Math.ceil(Math.log2(list.length + 1)));
      // every comparison involves the candidate
      for (const c of comparisons) {
        expect([c.winner, c.loser]).toContain("new");
      }
    }
  });

  it("builds a full list from scratch via replay (seed-generation path)", () => {
    const final = ["w", "x", "y", "z"];
    const arrival = ["y", "w", "z", "x"];
    let list: string[] = [];
    for (const id of arrival) {
      const placed = new Set(list);
      const target = final.filter((s) => placed.has(s) || s === id).indexOf(id);
      list = replayInsertion(id, list, target).list;
    }
    expect(list).toEqual(final);
  });
});
