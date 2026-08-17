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
