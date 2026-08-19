// @vitest-environment node
//
// The hero surface, in the one state nobody had drawn: a link minted before
// its owner has ranked anywhere. `POST /api/share` will issue a ranking token
// for an account created a second ago, and Profile.tsx offers the button on
// an empty ranking — so this page was reachable, and it read:
//
//   All 0, in order            (over an empty <ol>)
//   Everything 0               (the only chip)
//   0 places, put in order by one person who actually went.
//
// sent to somebody by name. `/p/:token` has had a designed sentence for this
// since Phase 5A; this holds the same line on `/s/`.

import { describe, expect, it } from "vitest";
import { renderShare } from "./shareList.ts";
import type { ShareData } from "./shareData.ts";

function data(entries: ShareData["entries"]): ShareData {
  return {
    token: "TestToken123",
    kind: "ranking",
    title: "Maya’s list",
    author: {
      name: "Maya Okafor",
      firstName: "Maya",
      username: "maya",
      school: "Ohio State",
      avatar: null,
      tasteLine: null,
      signatureOrder: null,
    },
    entries,
    tagCounts: [],
    updatedAt: null,
  };
}

describe("the share page with nothing in order", () => {
  const html = renderShare(data([]));

  it("says so, and never counts to zero", () => {
    expect(html).toContain("data-empty");
    expect(html).toContain("hasn’t put anywhere in order");
    expect(html).not.toContain("All 0, in order");
    expect(html).not.toMatch(/\b0 places\b/);
    expect(html).not.toContain("data-count");
  });

  it("still introduces the author, which is what decision 2 asks for first", () => {
    expect(html).toContain("Maya Okafor");
    expect(html).toContain("Ohio State");
    expect(html).toContain("data-author");
  });

  it("keeps the one door out, and offers no filters over nothing", () => {
    expect(html).toContain('href="/onboarding"');
    expect(html).not.toContain("data-chip-all");
    expect(html).not.toContain("<ol>");
  });

  it("does not describe an empty list as a ranking of zero places", () => {
    const desc = /<meta property="og:description" content="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(desc).not.toMatch(/\b0 places\b/);
    expect(desc).toContain("hasn’t put anywhere");
  });
});

// The page ships one inline script and it is minified by stripping every
// newline, which makes a `//` comment inside it a shredder: everything after
// it on the joined line is commented out, the HTML still renders perfectly,
// and the only symptom is that the chips stop working. That is precisely what
// a comment added to the filter cost — the hero surface's one interactive
// element, dead, with `Unexpected end of input` in a console nobody had open.
// A syntax check is two lines and would have caught it before the build.
describe("the inline script", () => {
  const entry: ShareData["entries"][number] = {
    position: 1,
    name: "Lantern Lane Cafe",
    slug: "lantern-lane",
    initials: "LLC",
    palette: "warm",
    photo: null,
    line: "The couch by the green lamp.",
    tags: ["deep_work"],
    tagLabels: ["Deep work"],
    facts: ["11 min"],
    cosignState: "none",
    cosigners: [],
    cosignOthers: 0,
  };
  const html = renderShare({ ...data([entry]), tagCounts: [{ tag: "deep_work", label: "Deep work", count: 1 }] });
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

  it("is there at all, once there is a list to filter", () => {
    expect(script.length).toBeGreaterThan(200);
    expect(script).toContain("data-chip");
  });

  it("parses — no comment has eaten the rest of it", () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it("would have caught the comment that broke it", () => {
    // The check above passes trivially on a script nobody has damaged, so
    // damage one the exact way the real bug did: the shipped text is a
    // single joined line, and a `//` dropped anywhere inside it swallows
    // every brace to the end.
    expect(script).not.toContain("\n");
    const commented = script.replace("function apply(", "// a note\nfunction apply(").replace(/\n/g, "");
    expect(commented).not.toBe(script);
    expect(() => new Function(commented)).toThrow();
  });
});
