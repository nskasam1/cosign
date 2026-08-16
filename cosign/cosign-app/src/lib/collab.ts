// Collaborative lists (brief #8): "our ranking of campus coffee".
//
// A list with one contributor is the order its owner added things in. A list
// with two or more stops being anybody's order and becomes the group's, and
// the operation that makes it is the same one the whole product is built on:
// head-to-head. For every pair of places on the list, count the contributors
// whose own ordered list puts one above the other; the pair goes to whoever
// more of them put first. That is a comparison, not a score — nothing here
// averages a position, and there is no number on this surface that could be
// mistaken for a rating.
//
// Pure, like the rest of src/lib: the server runs it and the tests can hand
// it any set of lists at all.

export interface Contributor {
  user_id: string;
  display_name: string;
  /** Their canonical ordered ranking, best first. May not cover the list. */
  ranking: string[];
}

export interface CollabInput {
  shop_id: string;
  /** Where it sits now — the order the owner built, and the stable tiebreak. */
  position: number;
  added_by: string;
}

export interface ContributorPosition {
  user_id: string;
  position: number;
  of: number;
}

export interface CollabRow {
  shop_id: string;
  /** Pairs won, lost and drawn against the other places ON THIS LIST. */
  wins: number;
  losses: number;
  draws: number;
  /**
   * What the list calls it: 1, 2, 3, 3, 5 — two places SHARE a standing when
   * the contributors ordered them against each other and came out level. An
   * average would settle it, and settling it would be inventing an opinion
   * nobody holds, so the list says third twice and has no fourth.
   */
  standing: number;
  /** True when this row shares its standing with the row above it. */
  tied_with_previous: boolean;
  /** Everyone who can edit this list and has ranked it, best position first. */
  positions: ContributorPosition[];
}

/** Two places the contributors order in opposite directions. */
export interface Disagreement {
  a: string;
  b: string;
  /** display names, for a sentence a person can read */
  forA: string[];
  forB: string[];
}

export interface CollabOrder {
  /**
   * `owner` — fewer than two contributors have ranked anything on it, so
   * there is nothing to merge and the list keeps the order it was built in.
   * `contributors` — the order below came from the lists, not from anybody's
   * arranging.
   */
  source: "owner" | "contributors";
  contributors: number;
  /** Derived order, best first. Empty when `source` is `owner`. */
  ranked: CollabRow[];
  /**
   * On the list, but nobody who can edit it has put it in order — so it
   * cannot be compared with anything and is not given a standing it has not
   * earned. Kept in the order it was added.
   */
  unranked: CollabRow[];
  disagreements: Disagreement[];
}

/** 1.0 for a #1, 0.0 for a last place, 1.0 for a list of one. */
function percentile(position: number, of: number): number {
  return of <= 1 ? 1 : 1 - (position - 1) / (of - 1);
}

/**
 * The derived order. Ties are broken by evidence and then by the list's own
 * history — never by a mean position, which is the one move that would turn
 * an order built from comparisons back into an average of ranks.
 *
 *   1. pairs won minus pairs lost (Copeland — the head-to-head, generalised)
 *   2. how many contributors have ranked it at all
 *   3. the highest single position any contributor gives it
 *   4. where it already sat, then its id — so the order is total and stable
 */
export function collabOrder(items: CollabInput[], contributors: Contributor[]): CollabOrder {
  const rankers = contributors.filter((c) => c.ranking.length > 0);
  const indexOf = new Map<string, Map<string, number>>();
  for (const c of rankers) {
    indexOf.set(c.user_id, new Map(c.ranking.map((shopId, i) => [shopId, i])));
  }

  const rowOf = (it: CollabInput): CollabRow => ({
    shop_id: it.shop_id,
    wins: 0,
    losses: 0,
    draws: 0,
    standing: 0,
    tied_with_previous: false,
    positions: rankers
      .filter((c) => indexOf.get(c.user_id)!.has(it.shop_id))
      .map((c) => ({
        user_id: c.user_id,
        position: indexOf.get(c.user_id)!.get(it.shop_id)! + 1,
        of: c.ranking.length,
      }))
      .sort((a, b) => percentile(b.position, b.of) - percentile(a.position, a.of)),
  });

  const rows = new Map(items.map((it) => [it.shop_id, rowOf(it)]));
  const order = new Map(items.map((it) => [it.shop_id, it.position]));

  if (rankers.length < 2) {
    return {
      source: "owner",
      contributors: rankers.length,
      ranked: [],
      unranked: [...items]
        .sort((a, b) => a.position - b.position)
        .map((it) => rows.get(it.shop_id)!),
      disagreements: [],
    };
  }

  const ranked = items.filter((it) => rows.get(it.shop_id)!.positions.length > 0);
  const disagreements: Disagreement[] = [];
  /** `pair.get(a)!.get(b)` is +1 when a leads b, -1 when b leads, 0 for a
   *  draw, and absent when no contributor has ordered both. */
  const pair = new Map<string, Map<string, number>>();
  const set = (a: string, b: string, v: number) => {
    if (!pair.has(a)) pair.set(a, new Map());
    if (!pair.has(b)) pair.set(b, new Map());
    pair.get(a)!.set(b, v);
    pair.get(b)!.set(a, -v);
  };

  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      const a = ranked[i].shop_id;
      const b = ranked[j].shop_id;
      const forA: string[] = [];
      const forB: string[] = [];
      for (const c of rankers) {
        const idx = indexOf.get(c.user_id)!;
        const ia = idx.get(a);
        const ib = idx.get(b);
        // A contributor only weighs in on a pair they have ordered BOTH of.
        // "I have never been to one of them" is not a preference.
        if (ia === undefined || ib === undefined) continue;
        (ia < ib ? forA : forB).push(c.display_name);
      }
      if (forA.length === 0 && forB.length === 0) continue;
      if (forA.length > forB.length) {
        rows.get(a)!.wins++;
        rows.get(b)!.losses++;
        set(a, b, 1);
      } else if (forB.length > forA.length) {
        rows.get(b)!.wins++;
        rows.get(a)!.losses++;
        set(a, b, -1);
      } else {
        rows.get(a)!.draws++;
        rows.get(b)!.draws++;
        set(a, b, 0);
      }
      if (forA.length > 0 && forB.length > 0) disagreements.push({ a, b, forA, forB });
    }
  }

  const copeland = (r: CollabRow) => r.wins - r.losses;
  const best = (r: CollabRow) => (r.positions[0] ? percentile(r.positions[0].position, r.positions[0].of) : 0);
  /** The keys that decide when the pairs cannot: evidence, then history. */
  const fallback = (x: CollabRow, y: CollabRow) =>
    y.positions.length - x.positions.length ||
    best(y) - best(x) ||
    (order.get(x.shop_id) ?? 0) - (order.get(y.shop_id) ?? 0) ||
    x.shop_id.localeCompare(y.shop_id);

  const sorted = ranked
    .map((it) => rows.get(it.shop_id)!)
    .sort((x, y) => copeland(y) - copeland(x) || fallback(x, y));

  // Level across the whole list, so the pair itself decides — re-sorted
  // WITHIN each tied group on a local score (wins minus losses against that
  // group alone) rather than by a pairwise comparator, because a comparator
  // that disagrees with itself around a cycle gives an order the language
  // does not define.
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && copeland(sorted[j]) === copeland(sorted[i])) j++;
    if (j - i > 1) {
      const group = sorted.slice(i, j);
      const ids = new Set(group.map((r) => r.shop_id));
      const local = (r: CollabRow) =>
        [...(pair.get(r.shop_id) ?? new Map())]
          .filter(([id]) => ids.has(id))
          .reduce((n, [, v]) => n + v, 0);
      group.sort((x, y) => local(y) - local(x) || fallback(x, y));
      sorted.splice(i, group.length, ...group);
    }
    i = j;
  }

  // Competition standings: 1, 2, 3, 3, 5. Two rows share one only when the
  // contributors ordered them against each other and came out LEVEL — an
  // unjudged pair is silence, not a tie, and silence does not create one.
  sorted.forEach((row, i) => {
    const above = sorted[i - 1];
    const level =
      !!above && copeland(above) === copeland(row) && pair.get(above.shop_id)?.get(row.shop_id) === 0;
    row.tied_with_previous = level;
    row.standing = level ? above.standing : i + 1;
  });

  return {
    source: "contributors",
    contributors: rankers.length,
    ranked: sorted,
    unranked: items
      .filter((it) => rows.get(it.shop_id)!.positions.length === 0)
      .sort((a, b) => a.position - b.position)
      .map((it) => rows.get(it.shop_id)!),
    disagreements,
  };
}

/** Does applying this order actually move anything? A re-rank that changes
 *  nothing is not an event and must not notify anybody. */
export function movesAnything(items: CollabInput[], next: CollabOrder): boolean {
  const after = [...next.ranked, ...next.unranked].map((r) => r.shop_id);
  const before = [...items].sort((a, b) => a.position - b.position).map((it) => it.shop_id);
  return after.length !== before.length || after.some((id, i) => before[i] !== id);
}
