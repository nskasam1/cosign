// @vitest-environment node
//
// The sentences Home and Search say about a place. Two of these are rules
// rather than wording — never name more than two people, and never name
// anybody who is not an accepted friend — so they are tested rather than
// reviewed.

import { describe, expect, it } from "vitest";
import {
  clockLabel,
  closingLabel,
  countWord,
  factsOf,
  freshnessBand,
  friendSentence,
  isLastThroughTheDoor,
  ordinalWord,
  todaysWindow,
  type PlaceLike,
} from "./placeCopy";

const NOW = new Date("2026-08-15T14:00:00-04:00");

const place = (over: Partial<PlaceLike> = {}): PlaceLike => ({
  walk_min: 7,
  open_now: true,
  closes_in_min: 180,
  amenities: { outlet_count: 16 },
  you: null,
  friends: [],
  others: 0,
  cosign_total: 0,
  age: { label: "checked 4 days ago", stale: false },
  ...over,
});

const friend = (display_name: string, position: number) => ({ display_name, position });

describe("positions are words, never fractions", () => {
  it("names the first twenty-two", () => {
    expect(ordinalWord(1)).toBe("first");
    expect(ordinalWord(4)).toBe("fourth");
    expect(ordinalWord(22)).toBe("twenty-second");
  });

  it("stops pretending past that", () => {
    expect(ordinalWord(39)).toBe("number 39");
  });

  it("counts in words up to ten", () => {
    expect(countWord(0)).toBe("no");
    expect(countWord(1)).toBe("one");
    expect(countWord(10)).toBe("ten");
    expect(countWord(41)).toBe("41");
  });
});

describe("when it shuts", () => {
  it("names the hour", () => {
    expect(closingLabel(180, NOW)).toBe("open till 5 pm");
    expect(closingLabel(510, NOW)).toBe("open till 10:30 pm");
  });

  it("stops giving a clock time once the answer is 'all night'", () => {
    // The All-Nighter runs Thursday to Monday; "open till 1 am on Monday"
    // is not what anybody wanted to know.
    expect(closingLabel(4920, NOW)).toBe("open all night");
    expect(closingLabel(12 * 60 + 1, NOW)).toBe("open all night");
    expect(closingLabel(12 * 60, NOW)).toBe("open till 2 am");
  });

  it("says shut rather than zero", () => {
    expect(closingLabel(null, NOW)).toBe("shut");
  });

  it("reads a clock in minutes-since-midnight", () => {
    expect(clockLabel(0)).toBe("12 am");
    expect(clockLabel(720)).toBe("12 pm");
    expect(clockLabel(1290)).toBe("9:30 pm");
    expect(clockLabel(1560)).toBe("2 am"); // past midnight, next day
  });

  it("formats today's window from the hours rows", () => {
    // 2026-08-15 is a Saturday, day 6.
    const hours = [
      { day: 6, open_min: 450, close_min: 1320 },
      { day: 1, open_min: 420, close_min: 1260 },
    ];
    expect(todaysWindow(hours, NOW)).toBe("7:30 am – 10 pm");
    expect(todaysWindow([{ day: 6, open_min: 0, close_min: 1440 }], NOW)).toBe("all day");
    expect(todaysWindow([{ day: 1, open_min: 420, close_min: 1260 }], NOW)).toBeNull();
  });
});

describe("the facts line is facts", () => {
  it("carries walk, hours and outlets", () => {
    expect(factsOf(place(), NOW)).toEqual(["7 min", "open till 5 pm", "16 outlets"]);
  });

  it("says no outlets rather than omitting the row", () => {
    expect(factsOf(place({ amenities: { outlet_count: 0 } }), NOW)).toContain("no outlets");
  });

  it("omits outlets entirely when nobody has counted them", () => {
    const facts = factsOf(place({ amenities: null }), NOW);
    expect(facts.some((f) => f.includes("outlet"))).toBe(false);
  });

  it("adds your own position as a word", () => {
    expect(factsOf(place({ you: 3 }), NOW)).toContain("your third");
  });

  it("never contains a score", () => {
    for (const you of [1, 5, 10, 22]) {
      for (const f of factsOf(place({ you }), NOW)) {
        expect(f).not.toMatch(/\d\s*(?:\/|out of)\s*\d/);
      }
    }
  });
});

describe("who put it in order", () => {
  it("says nothing when nobody has", () => {
    expect(friendSentence(place())).toBeNull();
  });

  it("names one friend and their position", () => {
    expect(friendSentence(place({ friends: [friend("Priya Shenoy", 4)], cosign_total: 1 }))).toBe(
      "Priya ranks it fourth.",
    );
  });

  it("names two, and counts the rest", () => {
    expect(
      friendSentence(
        place({ friends: [friend("Priya Shenoy", 4), friend("Theo Marsh", 6)], cosign_total: 6 }),
      ),
    ).toBe("Priya ranks it fourth, Theo sixth. Four more lists have it too.");
  });

  it("NEVER names more than two, however many friends have it", () => {
    // The cap is the mechanism: with three per row you could walk the column
    // and reassemble a friend's whole ordering.
    const many = ["Ana", "Ben", "Cal", "Dee", "Eve"].map((n, i) => friend(`${n} Surname`, i + 1));
    const sentence = friendSentence(place({ friends: many, cosign_total: 5 }))!;
    const named = ["Ana", "Ben", "Cal", "Dee", "Eve"].filter((n) => sentence.includes(n));
    expect(named).toEqual(["Ana", "Ben"]);
    expect(sentence).toBe("Ana ranks it first, Ben second. Three more lists have it too.");
  });

  it("counts strangers rather than naming them, because it is never given their names", () => {
    expect(friendSentence(place({ cosign_total: 3 }))).toBe("On three lists near campus.");
    expect(friendSentence(place({ cosign_total: 1 }))).toBe("On one list near campus.");
  });

  it("does not count you as a stranger", () => {
    expect(friendSentence(place({ you: 2, cosign_total: 1 }))).toBe("Only on your list so far.");
    expect(friendSentence(place({ you: 2, cosign_total: 3 }))).toBe("On two lists near campus.");
  });

  it("leaves you out of the 'more lists' tail as well", () => {
    expect(
      friendSentence(place({ you: 1, friends: [friend("Priya Shenoy", 4)], cosign_total: 3 })),
    ).toBe("Priya ranks it fourth. One more list has it too.");
  });
});

describe("how loudly a row says its age", () => {
  it("is silent when somebody checked recently", () => {
    expect(freshnessBand({ days: 4, stale: false })).toBe("fresh");
    expect(freshnessBand({ days: 20.9, stale: false })).toBe("fresh");
  });

  it("murmurs in the middle", () => {
    expect(freshnessBand({ days: 21, stale: false })).toBe("aging");
    expect(freshnessBand({ days: 59, stale: false })).toBe("aging");
  });

  it("takes the facts out of the label voice once it is stale", () => {
    expect(freshnessBand({ days: 61, stale: true })).toBe("stale");
    expect(freshnessBand({ days: null, stale: true })).toBe("stale");
  });
});

describe("who gets asked to re-verify", () => {
  it("is whoever has been in since the facts were last confirmed", () => {
    expect(isLastThroughTheDoor("2026-06-06T10:00:00-04:00", "2026-06-02T09:30:00-04:00")).toBe(true);
  });

  it("is not somebody whose visit predates the check", () => {
    expect(isLastThroughTheDoor("2026-05-01T10:00:00-04:00", "2026-06-02T09:30:00-04:00")).toBe(false);
  });

  it("is not somebody who has never been", () => {
    expect(isLastThroughTheDoor(null, "2026-06-02T09:30:00-04:00")).toBe(false);
    expect(isLastThroughTheDoor(null, null)).toBe(false);
  });

  it("is anybody who has been, when nobody has ever checked", () => {
    expect(isLastThroughTheDoor("2026-05-01T10:00:00-04:00", null)).toBe(true);
  });
});
