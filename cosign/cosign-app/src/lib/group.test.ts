// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  constraintsFor,
  costliestConstraint,
  funnel,
  intersect,
  meets,
  sessionState,
  strictestNoise,
  type GroupNeed,
  type GroupPlace,
} from "./group";

const need = (p: string, over: Partial<GroupNeed> = {}): GroupNeed => ({
  participant: p,
  display_name: p,
  user_id: `u_${p}`,
  intent_tag: null,
  outlets: false,
  open_now: false,
  wifi: false,
  max_noise: null,
  ...over,
});

const place = (id: string, over: Partial<GroupPlace> = {}): GroupPlace => ({
  id,
  name: id,
  open_now: true,
  outlet_count: 8,
  wifi_mbps: 50,
  table_size: "laptop_plus_friend",
  noise: "quiet",
  noise_samples: 3,
  walk_min: 5,
  positions: [],
  ...over,
});

describe("the needs union into constraints", () => {
  it("takes every constraint anybody asked for, and no others", () => {
    const cs = constraintsFor([need("a", { outlets: true }), need("b", { open_now: true })]);
    expect(cs.map((c) => c.key).sort()).toEqual(["open_now", "outlets"]);
    expect(cs.find((c) => c.key === "outlets")!.askedBy).toEqual(["a"]);
  });

  it("outlets scale with the number of people who need one", () => {
    const two = constraintsFor([need("a", { outlets: true }), need("b", { outlets: true })]);
    expect(two.find((c) => c.key === "outlets")!.detail).toBe("2 outlets");
    // three of the four plugging in is three outlets, not one
    const three = [need("a", { outlets: true }), need("b", { outlets: true }), need("c", { outlets: true })];
    expect(meets(place("x", { outlet_count: 2 }), constraintsFor(three)[0], three)).toBe(false);
    expect(meets(place("x", { outlet_count: 3 }), constraintsFor(three)[0], three)).toBe(true);
  });

  it("the strictest noise ceiling in the group is the group's", () => {
    const needs = [need("a", { max_noise: "loud" }), need("b", { max_noise: "quiet" })];
    expect(strictestNoise(needs)).toBe("quiet");
    expect(constraintsFor(needs).find((c) => c.key === "noise")!.askedBy).toEqual(["b"]);
  });

  it("a party of three needs a table without anybody asking; a pair does not", () => {
    expect(constraintsFor([need("a"), need("b")]).some((c) => c.key === "table")).toBe(false);
    const three = constraintsFor([need("a"), need("b"), need("c")]);
    expect(three.find((c) => c.key === "table")!.detail).toBe("a table for 3");
    expect(three.find((c) => c.key === "table")!.askedBy).toEqual([]);
  });
});

describe("a place nobody has logged this hour cannot answer a noise question", () => {
  const needs = [need("a", { max_noise: "quiet" })];
  const noise = constraintsFor(needs).find((c) => c.key === "noise")!;

  it("says unknown rather than passing or failing", () => {
    expect(meets(place("x", { noise: null, noise_samples: 0 }), noise, needs)).toBe("unknown");
    expect(meets(place("x", { noise: "quiet" }), noise, needs)).toBe(true);
    expect(meets(place("x", { noise: "loud" }), noise, needs)).toBe(false);
  });

  it("and is offered as unvouched, not silently dropped or silently allowed", () => {
    const answer = intersect(needs, [
      place("known", { noise: "quiet", positions: [{ user_id: "u_a", position: 1, of: 4 }] }),
      place("nobody", { noise: null, noise_samples: 0, positions: [{ user_id: "u_a", position: 2, of: 4 }] }),
    ]);
    expect(answer.picks.map((p) => p.place.id)).toEqual(["known"]);
    expect(answer.unvouched.map((p) => p.id)).toEqual(["nobody"]);
    expect(answer.ruledOut).toHaveLength(0);
  });

  it("with nobody setting a ceiling there is no noise question to fail", () => {
    const answer = intersect([need("a")], [place("x", { noise: null, noise_samples: 0 })]);
    expect(answer.unvouched).toHaveLength(0);
  });
});

describe("the order is the least-happy member, maximised", () => {
  const needs = [need("a"), need("b"), need("c"), need("d")];

  // The regression that matters: the first cut of this function tiered on
  // coverage, and on the seeded campus it answered with a place all four had
  // been to and one of them ranks LAST — over a place two of them have in
  // their top four. More evidence is not the same as less objection.
  it("prefers nobody's last place over everybody's last place", () => {
    const answer = intersect(needs, [
      place("all-been", {
        positions: [
          { user_id: "u_a", position: 1, of: 10 },
          { user_id: "u_b", position: 2, of: 10 },
          { user_id: "u_c", position: 3, of: 10 },
          { user_id: "u_d", position: 10, of: 10 },
        ],
      }),
      place("two-love-it", {
        positions: [
          { user_id: "u_a", position: 1, of: 10 },
          { user_id: "u_b", position: 4, of: 10 },
        ],
      }),
    ]);
    expect(answer.picks.map((p) => p.place.id)).toEqual(["two-love-it", "all-been"]);
    expect(answer.picks[0].worst).toEqual({ user_id: "u_b", position: 4, of: 10 });
    expect(answer.picks[1].worstPct).toBe(0);
  });

  // The opposite mistake, which the seeded campus also caught: ordering on
  // the worst position alone answered with one person's #2 that nobody else
  // had heard of, over the place two of them had in their top four.
  it("prefers what two of them rank well over one person's near-favourite", () => {
    const answer = intersect(needs, [
      place("one-persons", { positions: [{ user_id: "u_a", position: 2, of: 22 }] }),
      place("both-of-ours", {
        positions: [
          { user_id: "u_a", position: 1, of: 22 },
          { user_id: "u_b", position: 4, of: 10 },
        ],
      }),
    ]);
    expect(answer.picks.map((p) => p.place.id)).toEqual(["both-of-ours", "one-persons"]);
    expect(answer.picks.every((p) => p.unobjectionable)).toBe(true);
  });

  it("the bottom half of anybody's own list is an objection", () => {
    const answer = intersect(needs, [
      place("bottom-half", { positions: [{ user_id: "u_a", position: 6, of: 10 }] }),
      place("top-half", { positions: [{ user_id: "u_a", position: 5, of: 10 }] }),
    ]);
    expect(answer.picks.map((p) => [p.place.id, p.unobjectionable])).toEqual([
      ["top-half", true],
      ["bottom-half", false],
    ]);
  });

  it("between two places nobody objects to, the one more of them know wins", () => {
    const answer = intersect(needs, [
      place("thin", { positions: [{ user_id: "u_a", position: 1, of: 10 }] }),
      place("thick", {
        positions: [
          { user_id: "u_a", position: 1, of: 10 },
          { user_id: "u_b", position: 1, of: 10 },
        ],
      }),
    ]);
    expect(answer.picks.map((p) => p.place.id)).toEqual(["thick", "thin"]);
  });

  it("never been is neutral, not a zero", () => {
    // u_d has ranked nothing at all; that must not drag anything to the floor
    const answer = intersect(needs, [place("x", { positions: [{ user_id: "u_a", position: 1, of: 4 }] })]);
    expect(answer.picks[0].worstPct).toBe(1);
    expect(answer.picks[0].coverage).toBe(1);
  });

  it("a place nobody in the group has ranked is offered as exactly that", () => {
    const answer = intersect(needs, [
      place("ranked", { positions: [{ user_id: "u_a", position: 3, of: 4 }] }),
      place("stranger"),
    ]);
    expect(answer.picks.map((p) => p.place.id)).toEqual(["ranked"]);
    expect(answer.unknownToAll.map((p) => p.id)).toEqual(["stranger"]);
  });
});

describe("when nothing works, it names what is costing the group", () => {
  const needs = [
    need("a", { outlets: true }),
    need("b", { outlets: true }),
    need("c", { max_noise: "quiet" }),
  ];
  const places = [
    place("loud-with-outlets", { noise: "loud", outlet_count: 8 }),
    place("quiet-no-outlets", { noise: "quiet", outlet_count: 0 }),
    place("quiet-one-outlet", { noise: "quiet", outlet_count: 1 }),
  ];

  it("finds nothing, and says which single need frees the most tables", () => {
    const answer = intersect(needs, places);
    expect(answer.picks).toHaveLength(0);
    expect(answer.unknownToAll).toHaveLength(0);
    // dropping "2 outlets" frees the two quiet ones; dropping "quiet" frees one
    expect(answer.costliest).toEqual({ key: "outlets", detail: "2 outlets", unlocks: 2 });
  });

  it("a tie goes to the need the fewest people asked for", () => {
    const tied = [
      need("a", { wifi: true }),
      need("b", { wifi: true }),
      need("c", { max_noise: "quiet" }),
    ];
    const two = [place("no-wifi-quiet", { wifi_mbps: null }), place("wifi-loud", { noise: "loud" })];
    // either drop frees exactly one place; the one person's ceiling gives way
    // before the two people's wifi
    expect(costliestConstraint(tied, two)).toEqual({ key: "noise", detail: "quiet", unlocks: 1 });
  });

  it("the table is never offered as the thing to give up", () => {
    const four = [need("a"), need("b"), need("c"), need("d", { max_noise: "quiet" })];
    const only = [place("counter", { table_size: "mug_only", noise: "loud" })];
    // dropping the noise ceiling still leaves the counter, which cannot seat
    // four — so there is nothing to suggest, and it says so rather than
    // suggesting the group stop needing somewhere to sit
    expect(costliestConstraint(four, only)).toBeNull();
  });

  it("says nothing about cost while there is still something to sit at", () => {
    expect(intersect([need("a")], [place("fine")]).costliest).toBeNull();
  });
});

describe("the arithmetic subtracts to the answer", () => {
  const needs = [
    need("a", { open_now: true, outlets: true }),
    need("b", { outlets: true, wifi: true }),
    need("c", { max_noise: "quiet" }),
  ];
  const places = [
    place("shut", { open_now: false }),
    place("no-outlets", { outlet_count: 1 }), // two people need one each
    place("no-wifi", { wifi_mbps: null }),
    place("loud", { noise: "loud" }),
    place("unlogged", { noise: null, noise_samples: 0 }),
    place("fine", { positions: [{ user_id: "u_a", position: 1, of: 3 }] }),
  ];

  it("charges each need only for what the ones before it left", () => {
    const f = funnel(needs, places);
    expect(f.total).toBe(6);
    expect(f.steps.map((s) => [s.key, s.removed, s.remaining])).toEqual([
      ["open_now", 1, 5],
      // a party of three needs a table, and every place here has one
      ["table", 0, 5],
      ["outlets", 1, 4],
      ["wifi", 1, 3],
      ["noise", 1, 2],
    ]);
    // the unlogged room has not failed the question, it has declined to
    // answer it, and it is held rather than subtracted
    expect(f.held).toBe(1);
    expect(f.left).toBe(1);
    expect(f.left).toBe(intersect(needs, places).picks.length + intersect(needs, places).unknownToAll.length);
  });

  it("prints a need that cost nothing, which is the only way anybody learns it was cheap", () => {
    const cheap = [need("a", { wifi: true }), need("b", { max_noise: "quiet" })];
    const f = funnel(cheap, [place("x"), place("y")]);
    expect(f.steps.find((s) => s.key === "wifi")!.removed).toBe(0);
  });

  it("names who asked for each line", () => {
    const f = funnel(needs, places);
    expect(f.steps.find((s) => s.key === "outlets")!.askedBy).toEqual(["a", "b"]);
    expect(f.steps.find((s) => s.key === "noise")!.askedBy).toEqual(["c"]);
  });
});

describe("a session's state is about people, never about a timer", () => {
  it("one answer is not a group", () => {
    expect(sessionState(1, 4)).toBe("alone");
    expect(sessionState(0, 4)).toBe("alone");
  });

  it("two answers can be acted on while the rest are still out", () => {
    expect(sessionState(2, 4)).toBe("partial");
    expect(sessionState(3, 4)).toBe("partial");
  });

  it("everybody who was asked has answered", () => {
    expect(sessionState(4, 4)).toBe("complete");
    expect(sessionState(2, 2)).toBe("complete");
    // and it never waits for a fifth
    expect(sessionState(4, 9)).toBe("complete");
  });
});
