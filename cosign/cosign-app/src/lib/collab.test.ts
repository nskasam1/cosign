// @vitest-environment node
import { describe, expect, it } from "vitest";
import { collabOrder, movesAnything, type CollabInput, type Contributor } from "./collab";

const items = (...ids: string[]): CollabInput[] =>
  ids.map((shop_id, i) => ({ shop_id, position: i + 1, added_by: "u_owner" }));

const who = (user_id: string, ...ranking: string[]): Contributor => ({
  user_id,
  display_name: user_id.replace("u_", ""),
  ranking,
});

const ids = (rows: Array<{ shop_id: string }>) => rows.map((r) => r.shop_id);

describe("one contributor is not a collaboration", () => {
  it("keeps the order the list was built in, and says where it came from", () => {
    const list = items("a", "b", "c");
    const order = collabOrder(list, [who("u_owner", "c", "b", "a")]);
    expect(order.source).toBe("owner");
    expect(order.contributors).toBe(1);
    expect(order.ranked).toEqual([]);
    expect(ids(order.unranked)).toEqual(["a", "b", "c"]);
    expect(movesAnything(list, order)).toBe(false);
  });

  it("an editor who has ranked nothing does not make it two", () => {
    const order = collabOrder(items("a", "b"), [who("u_owner", "b", "a"), who("u_new")]);
    expect(order.source).toBe("owner");
    expect(order.contributors).toBe(1);
  });
});

describe("two contributors re-rank the list from their own lists", () => {
  const list = items("a", "b", "c");

  it("a pair goes to whoever more of them put first", () => {
    const order = collabOrder(list, [who("u_x", "c", "a", "b"), who("u_y", "c", "b", "a")]);
    expect(order.source).toBe("contributors");
    expect(order.contributors).toBe(2);
    // c beats both, unanimously; a and b split, so the pair is drawn and the
    // tie falls to the position the list already had
    expect(ids(order.ranked)).toEqual(["c", "a", "b"]);
    expect(order.ranked[0]).toMatchObject({ wins: 2, losses: 0, draws: 0 });
    expect(order.ranked[1]).toMatchObject({ wins: 0, losses: 1, draws: 1 });
    expect(movesAnything(list, order)).toBe(true);
  });

  it("a majority decides a pair even when somebody disagrees", () => {
    const order = collabOrder(list, [
      who("u_x", "a", "b", "c"),
      who("u_y", "a", "b", "c"),
      who("u_z", "c", "b", "a"),
    ]);
    expect(ids(order.ranked)).toEqual(["a", "b", "c"]);
  });

  it("a contributor only weighs in on a pair they have ordered both of", () => {
    // u_y has never been to `a`, so u_y's list says nothing about a-vs-b —
    // "I have not been" is not a preference, and reading it as one would let
    // an absence outvote an opinion
    const order = collabOrder(items("a", "b"), [who("u_x", "a", "b"), who("u_y", "b")]);
    expect(ids(order.ranked)).toEqual(["a", "b"]);
    expect(order.ranked[0]).toMatchObject({ wins: 1, losses: 0 });
    expect(order.ranked[0].positions).toEqual([{ user_id: "u_x", position: 1, of: 2 }]);
  });

  it("a place nobody who can edit has ranked is not given a standing", () => {
    const list2 = items("a", "nobody", "b");
    const order = collabOrder(list2, [who("u_x", "b", "a"), who("u_y", "b", "a")]);
    expect(ids(order.ranked)).toEqual(["b", "a"]);
    expect(ids(order.unranked)).toEqual(["nobody"]);
    expect(order.unranked[0]).toMatchObject({ wins: 0, losses: 0, draws: 0, positions: [] });
  });

  it("reports disagreement with names on both sides, and never a score", () => {
    const order = collabOrder(items("a", "b"), [who("u_x", "a", "b"), who("u_y", "b", "a")]);
    expect(order.disagreements).toEqual([{ a: "a", b: "b", forA: ["x"], forB: ["y"] }]);
    // a drawn pair leaves both where the list already had them
    expect(ids(order.ranked)).toEqual(["a", "b"]);
  });

  it("says nothing about a pair no contributor has ordered both of", () => {
    const order = collabOrder(items("a", "b"), [who("u_x", "a"), who("u_y", "b")]);
    expect(order.disagreements).toEqual([]);
    expect(order.ranked.every((r) => r.wins === 0 && r.losses === 0 && r.draws === 0)).toBe(true);
  });
});

describe("ties break on evidence, then on the list's own history", () => {
  it("a drawn pair stays in the order the list already had", () => {
    // one each way, so the contributors have said nothing the list did not
    // already say — and a draw must not be broken by averaging their two
    // positions, which would turn comparisons back into a mean of ranks
    const order = collabOrder(items("a", "b"), [who("u_x", "a", "b"), who("u_y", "b", "a")]);
    expect(ids(order.ranked)).toEqual(["a", "b"]);
    const flipped = collabOrder(items("b", "a"), [who("u_x", "a", "b"), who("u_y", "b", "a")]);
    expect(ids(flipped.ranked)).toEqual(["b", "a"]);
  });

  it("with no pair to judge, the one more contributors have ranked leads", () => {
    // nobody has ordered both, so neither wins a pair; `a` is on two lists
    // and `b` on one, and more people having been is the only evidence there
    const order = collabOrder(items("b", "a"), [who("u_x", "a"), who("u_y", "a"), who("u_z", "b")]);
    expect(order.contributors).toBe(3);
    expect(order.ranked.every((r) => r.wins === 0 && r.losses === 0)).toBe(true);
    expect(ids(order.ranked)).toEqual(["a", "b"]);
  });

  it("the derived order is stable: the same input gives the same order", () => {
    const list = items("a", "b", "c", "d");
    const contributors = [who("u_x", "d", "c", "b", "a"), who("u_y", "d", "b", "c", "a")];
    const first = ids(collabOrder(list, contributors).ranked);
    const again = ids(collabOrder(list, contributors).ranked);
    expect(again).toEqual(first);
    expect(first).toEqual(["d", "b", "c", "a"]);
  });
});

describe("two places the contributors cannot separate share a standing", () => {
  it("says third twice and has no fourth", () => {
    // x beats everything; y and z split one-one against each other and are
    // level on the rest of the list, so nothing can put one above the other
    const order = collabOrder(items("x", "y", "z", "w"), [
      who("u_a", "x", "y", "z", "w"),
      who("u_b", "x", "z", "y", "w"),
    ]);
    expect(order.ranked.map((r) => [r.shop_id, r.standing, r.tied_with_previous])).toEqual([
      ["x", 1, false],
      ["y", 2, false],
      ["z", 2, true],
      ["w", 4, false],
    ]);
  });

  it("does not chain a standing through pairs that were never level", () => {
    // "Level" is not transitive. a≡b and b≡c does not make a≡c, and joining a
    // standing by comparing against the row ABOVE alone collapsed three rows
    // under one numeral while the contributors had put the first decisively
    // above the third — a brace asserting an agreement nobody made.
    //
    // x beats everything. a and b split; b and c split; a beats c 1-0.
    const order = collabOrder(items("x", "a", "b", "c"), [
      who("u_1", "x", "a", "b", "c"),
      who("u_2", "x", "b", "a", "c"),
      who("u_3", "x", "b", "c", "a"),
    ]);
    const standings = order.ranked.map((r) => [r.shop_id, r.standing, r.tied_with_previous]);
    // whatever the order, no row may share a standing with a row it beat
    for (const row of order.ranked) {
      if (!row.tied_with_previous) continue;
      const i = order.ranked.indexOf(row);
      for (const above of order.ranked.slice(0, i).filter((r) => r.standing === row.standing)) {
        const decided = order.disagreements.some(
          (d) =>
            (d.a === above.shop_id && d.b === row.shop_id) || (d.b === above.shop_id && d.a === row.shop_id),
        );
        // a shared standing is only ever a DRAW, never a contested pair with
        // a majority on one side
        expect({ standings, pair: [above.shop_id, row.shop_id], decided }).toMatchObject({ decided: true });
      }
    }
  });

  it("silence is not a tie — an unjudged pair gets its own standing", () => {
    // nobody has ordered a against b, so there is nothing level about them
    const order = collabOrder(items("a", "b"), [who("u_x", "a"), who("u_y", "b")]);
    expect(order.ranked.map((r) => [r.standing, r.tied_with_previous])).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it("a decisive pair separates two places level on the rest of the list", () => {
    // p and q both go 1-1 overall, but they met and q won it
    const order = collabOrder(items("p", "q", "r"), [
      who("u_a", "q", "p", "r"),
      who("u_b", "q", "p", "r"),
    ]);
    const [first, second] = order.ranked;
    expect(first.shop_id).toBe("q");
    expect(second.tied_with_previous).toBe(false);
    expect(second.standing).toBe(2);
  });
});

describe("a re-rank that changes nothing is not an event", () => {
  it("reports no movement when the derived order is the order already there", () => {
    const list = items("a", "b", "c");
    const order = collabOrder(list, [who("u_x", "a", "b", "c"), who("u_y", "a", "b", "c")]);
    expect(ids(order.ranked)).toEqual(["a", "b", "c"]);
    expect(movesAnything(list, order)).toBe(false);
  });

  it("and reports movement when it does", () => {
    const list = items("a", "b", "c");
    const order = collabOrder(list, [who("u_x", "c", "b", "a"), who("u_y", "c", "b", "a")]);
    expect(movesAnything(list, order)).toBe(true);
  });
});
