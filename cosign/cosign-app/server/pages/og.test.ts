// @vitest-environment node
//
// What is actually ON the share card.
//
// `e2e/share.spec.ts` fetches `/og/s/:token` and its test was called "renders
// a 1200x630 png with the author, title, places and cosign count" while
// asserting only the content type and the two numbers in the PNG header. It
// could not have asserted the rest: satori converts every glyph to a path
// before resvg rasterises it, so the finished image contains no text at all
// and the only way back to the words is to read them off the element tree
// satori is handed. That tree is what this file checks — the card is a
// preview of a real person's list, and a card that names the wrong person or
// counts the wrong number of cosigns is a lie sent to their friends.

import { describe, expect, it } from "vitest";
import { ogTree } from "./og.ts";
import type { ShareData, ShareEntry } from "./shareData.ts";

/** Every string satori will draw, in the order it will draw it in. */
function textOf(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textOf);
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: unknown } }).props.children);
  }
  return [];
}

const entry = (position: number, name: string, named: number, others: number): ShareEntry => ({
  position,
  slug: name.toLowerCase().replace(/[^a-z]+/g, "-"),
  name,
  initials: name[0],
  palette: "warm",
  photo: null,
  line: null,
  tags: [],
  tagLabels: [],
  facts: [],
  cosigners: Array.from({ length: named }, (_, i) => ({
    username: `u${i}`,
    display_name: `Person ${i}`,
    avatar: null,
    is_friend: true,
  })),
  cosignOthers: others,
  cosignState: named > 0 ? "named" : "counted",
});

// Four places, twelve cosigns — and only ten of them on the three the card
// shows, so a count taken from the wrong array cannot pass by coincidence.
const ENTRIES = [
  entry(1, "Cardinal & Vine", 2, 3),
  entry(2, "Juniper", 1, 0),
  entry(3, "The Foundry", 0, 4),
  entry(4, "Night Owl", 0, 2),
];

const DATA: ShareData = {
  token: "TestToken123",
  kind: "ranking",
  title: "Maya's campus coffee, ranked",
  author: {
    name: "Maya Okafor",
    firstName: "Maya",
    username: "maya",
    school: "Ohio State",
    avatar: null,
    tasteLine: null,
    signatureOrder: null,
  },
  entries: ENTRIES,
  tagCounts: [],
  updatedAt: null,
};

describe("the share card says whose list it is", () => {
  const words = textOf(ogTree(DATA));

  it("names the author and their school", () => {
    expect(words).toContain("Maya Okafor");
    expect(words).toContain("Ohio State");
  });

  it("carries the list's own title, with a real apostrophe", () => {
    expect(words).toContain("Maya’s campus coffee, ranked");
    expect(words).not.toContain("Maya's campus coffee, ranked");
  });

  it("shows the top three by name and by position, and stops there", () => {
    expect(words).toContain("Cardinal & Vine");
    expect(words).toContain("Juniper");
    expect(words).toContain("The Foundry");
    // A preview is not the list. The fourth place is on the page behind the
    // link, not on the card.
    expect(words).not.toContain("Night Owl");
    expect(words.filter((w) => ["1", "2", "3"].includes(w))).toEqual(["1", "2", "3"]);
  });

  it("counts the whole list, not the three it shows", () => {
    expect(words).toContain("4 PLACES");
    // 2+3, 1+0, 0+4, 0+2 — the fourth place's two are in it, which is what
    // makes this different from summing what is drawn.
    expect(words).toContain("· COSIGNED 12 TIMES · RANKED, NEVER RATED");
  });
});

describe("the card holds the line the product holds", () => {
  it("never prints a score, a rating or a denominator", () => {
    const line = textOf(ogTree(DATA)).join(" ");
    expect(line).not.toMatch(/\d\s*\/\s*\d/);
    expect(line).not.toMatch(/\bout of\b|\bstars?\b|\brating\b/i);
    expect(line).toContain("RANKED, NEVER RATED");
  });
});
