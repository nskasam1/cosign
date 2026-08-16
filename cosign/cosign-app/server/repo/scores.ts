// Ranking aggregates: the crowd baseline and the friend-weighted score
// behind Home's order (decision 8 / brief #8). Moved here from rank.ts in
// Phase 4, which is where PLAN's file map always had them — rank.ts owns
// one user's ordered list, this owns what many lists say together.
//
// The baseline is aggregated RANK — the mean percentile position a place
// holds across people's ordered lists. Never an averaged rating: there are
// no ratings in this product to average.

import type { DatabaseSync } from "node:sqlite";
import { friendIdsOf } from "./social.ts";

export interface ShopScore {
  shop_id: string;
  /** 0..1, higher = better-ranked. 1.0 = everyone's #1. */
  score: number;
  /** Accumulated weight behind the score (a plain count for the crowd). */
  sample: number;
}

/**
 * Two scores, one meaning each — and deliberately NOT one blended score.
 *
 * Decision 8 described a friend *weight* (a friend's list counting three
 * times a stranger's). A weight cannot carry the sentence the brief actually
 * writes down, which is an invariant: at any fixed weight, enough strangers
 * outvote your friends, and the guarantee stops holding exactly when a
 * campus gets dense — which is the moat. So Phase 4 replaced the blend with
 * a lexicographic order: your people first, the crowd for everything they
 * have no opinion about. See src/lib/discover.ts's `discoveryOrder`.
 */

interface PositionRow {
  user_id: string;
  shop_id: string;
  position: number;
  n: number;
}

/** Everyone whose opinion counts as "somebody you'd actually ask". */
function innerCircle(db: DatabaseSync, viewerId: string | null): Set<string> {
  return viewerId ? new Set([viewerId, ...friendIdsOf(db, viewerId)]) : new Set<string>();
}

/**
 * Every ranked entry in the database with the length of the list it sits in.
 * One query; both scores are folded from it.
 */
function positions(db: DatabaseSync): PositionRow[] {
  return db
    .prepare(
      `SELECT re.user_id, re.shop_id, re.position, c.n
       FROM ranking_entries re
       JOIN (SELECT user_id, count(*) AS n FROM ranking_entries GROUP BY user_id) c
         ON c.user_id = re.user_id`,
    )
    .all() as unknown as PositionRow[];
}

/** 1.0 for a #1, 0.0 for a last place, 1.0 for a list of one. */
function percentile(position: number, n: number): number {
  return n === 1 ? 1 : 1 - (position - 1) / (n - 1);
}

function fold(rows: PositionRow[]): Map<string, ShopScore> {
  const byShop = new Map<string, ShopScore>();
  for (const r of rows) {
    const cur = byShop.get(r.shop_id) ?? { shop_id: r.shop_id, score: 0, sample: 0 };
    // running mean: the number of lists folded in lives in `sample`
    cur.score = (cur.score * cur.sample + percentile(r.position, r.n)) / (cur.sample + 1);
    cur.sample += 1;
    byShop.set(r.shop_id, cur);
  }
  return byShop;
}

/** The crowd baseline: every list counts once, nobody counts twice. */
export function crowdScores(db: DatabaseSync): Map<string, ShopScore> {
  return fold(positions(db));
}

/**
 * How highly the people this viewer would actually ask rank each place —
 * their accepted friends, and themself. Nobody else is in it at all, which
 * is what makes it an invariant rather than a knob: no number of strangers
 * can move a place inside this score, because strangers are not in it.
 *
 * A logged-out viewer has no friends, so this is empty and every place
 * falls through to the crowd baseline — the honest degradation, and the
 * same one a brand-new account gets.
 */
export function friendScores(db: DatabaseSync, viewerId: string | null): Map<string, ShopScore> {
  const inner = innerCircle(db, viewerId);
  if (inner.size === 0) return new Map();
  // Percentiles are computed within the inner circle's own lists, so a
  // friend's #1 of six is a 1.0 whatever the rest of campus thinks.
  return fold(positions(db).filter((r) => inner.has(r.user_id)));
}

/** Shop ids best-first — the shape both the UI and the tests compare on. */
export function orderOf(scores: Map<string, ShopScore>): string[] {
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || b.sample - a.sample || a.shop_id.localeCompare(b.shop_id))
    .map((s) => s.shop_id);
}

export interface FriendOnList {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  position: number;
}

/**
 * Why a place is where it is, in names the viewer is allowed to read.
 *
 * Only accepted friends are ever named. That is stricter than
 * `rank.cosignersOf`, which may also name a stranger whose ranking is
 * public — on a discovery surface the useful signal is "the people you'd
 * actually ask" (decision 13), and naming nobody else means this line
 * cannot leak anything the viewer could not already open.
 *
 * `others` counts every remaining list, so the total stays honest.
 */
export interface FriendSignal {
  shop_id: string;
  /** The viewer's own position in their own list, if they have one. */
  you: number | null;
  friends: FriendOnList[];
  others: number;
  total: number;
}

export function friendSignals(db: DatabaseSync, viewerId: string | null): Map<string, FriendSignal> {
  const friendIds: Set<string> = viewerId ? new Set(friendIdsOf(db, viewerId)) : new Set<string>();
  const rows = db
    .prepare(
      `SELECT re.shop_id, re.user_id, re.position, u.username, u.display_name, u.avatar
       FROM ranking_entries re JOIN users u ON u.id = re.user_id
       ORDER BY re.position`,
    )
    .all() as unknown as Array<FriendOnList & { shop_id: string }>;

  const byShop = new Map<string, FriendSignal>();
  for (const r of rows) {
    const cur =
      byShop.get(r.shop_id) ?? { shop_id: r.shop_id, you: null, friends: [], others: 0, total: 0 };
    cur.total++;
    if (viewerId && r.user_id === viewerId) cur.you = r.position;
    else if (friendIds.has(r.user_id)) cur.friends.push(r);
    else cur.others++;
    byShop.set(r.shop_id, cur);
  }
  for (const signal of byShop.values()) signal.friends.sort((a, b) => a.position - b.position);
  return byShop;
}
