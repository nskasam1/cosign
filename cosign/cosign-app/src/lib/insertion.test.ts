// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyComparison,
  finalIndex,
  finalList,
  isDone,
  nextOpponent,
  replayInsertion,
  startInsertion,
} from "./insertion";

/** Drive an insertion using a ground-truth order to answer comparisons, and
 *  record who the user was shown — the opponents are the flow, not a detail. */
function insertWithOracle(candidate: string, list: string[], truth: string[]) {
  let state = startInsertion(candidate, list);
  const opponents: string[] = [];
  while (!isDone(state)) {
    const opp = nextOpponent(state)!;
    opponents.push(opp);
    state = applyComparison(state, truth.indexOf(candidate) < truth.indexOf(opp));
  }
  return { state, taps: opponents.length, opponents };
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

// The four cases the phase is accepted on, driven by the shipped data rather
// than by a/b/c/d — the opponent sequence is what the user actually taps
// through, so it is asserted, not just the destination.

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RANKINGS = JSON.parse(
  readFileSync(join(APP, "seed", "rankings.json"), "utf-8"),
) as Record<string, { final: string[] }>;

const LENA = RANKINGS.u_lena.final;
const CANDIDATE = "s_foundry"; // in three other seeded rankings, not in Lena's

describe("insertion into the seeded rankings", () => {
  it("u_noah, the empty-ranking fixture: no comparisons, lands at position 1", () => {
    expect(RANKINGS.u_noah).toBeUndefined();
    const state = startInsertion(CANDIDATE, []);
    expect(isDone(state)).toBe(true);
    expect(nextOpponent(state)).toBeNull();
    expect(finalIndex(state) + 1).toBe(1);
    expect(finalList(state)).toEqual([CANDIDATE]);
  });

  it("head of u_lena's six: 3 taps, position 1", () => {
    expect(LENA).toEqual([
      "s_oval-grounds",
      "s_percolate",
      "s_high-street-standard",
      "s_wheelhouse",
      "s_short-north-drip",
      "s_juniper",
    ]);
    const truth = [CANDIDATE, ...LENA];
    const { state, taps, opponents } = insertWithOracle(CANDIDATE, LENA, truth);
    expect(opponents).toEqual(["s_wheelhouse", "s_percolate", "s_oval-grounds"]);
    expect(taps).toBe(3);
    expect(finalIndex(state) + 1).toBe(1);
    expect(finalList(state)).toEqual(truth);
  });

  it("middle of u_lena's six: 3 taps, position 3", () => {
    const truth = [...LENA.slice(0, 2), CANDIDATE, ...LENA.slice(2)];
    const { state, taps, opponents } = insertWithOracle(CANDIDATE, LENA, truth);
    expect(opponents).toEqual(["s_wheelhouse", "s_percolate", "s_high-street-standard"]);
    expect(taps).toBe(3);
    expect(finalIndex(state) + 1).toBe(3);
    expect(finalList(state)).toEqual(truth);
  });

  it("tail of u_lena's six: 2 taps, position 7", () => {
    const truth = [...LENA, CANDIDATE];
    const { state, taps, opponents } = insertWithOracle(CANDIDATE, LENA, truth);
    // the upper half is settled after one loss, so the worst place to belong
    // is not the most expensive place to find
    expect(opponents).toEqual(["s_wheelhouse", "s_juniper"]);
    expect(taps).toBe(2);
    expect(finalIndex(state) + 1).toBe(7);
    expect(finalList(state)).toEqual(truth);
  });

  it("stays inside the promised bound anywhere in the largest seeded ranking", () => {
    expect(RANKINGS.u_maya.final).toHaveLength(22);
    const list = RANKINGS.u_maya.final.filter((s) => s !== CANDIDATE); // 21 places
    for (let target = 0; target <= list.length; target++) {
      const truth = [...list.slice(0, target), CANDIDATE, ...list.slice(target)];
      const { taps } = insertWithOracle(CANDIDATE, list, truth);
      expect(taps).toBeLessThanOrEqual(5); // ceil(log2(22))
    }
  });
});
