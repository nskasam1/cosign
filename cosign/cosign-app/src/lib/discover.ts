// Discovery: the hero query and the friend-weighted order behind Home
// (brief #7 and #8). Pure — no DB, no DOM, no clock of its own — so the
// server can compute it and the unit tests can move the campus, the clock
// and the calendar around underneath it.
//
// Two jobs, deliberately kept apart:
//   the HERO is a functional query — near me, open now, has outlets;
//   the LIST is a taste order — whoever your friends rank highest.
// Blending them would make "near me" quietly outrank a friend's #1, and
// the brief asks for both, separately.

import { haversineMeters, walkingMinutes, type LatLng } from "./geo";
import type { SemesterPhase } from "@/types/cosign";

/** How far "near me" reaches. Twenty-five minutes is the far end of campus. */
export const NEAR_ME_MAX_WALK_MIN = 25;

/**
 * The hero query never changes — the brief names it verbatim. What changes
 * in finals week is which of its matches wins: in week ten the nearest one
 * is right, and in finals the one you can sit in until it closes is.
 */
export type HeroMode = "usual" | "finals";

export function heroModeFor(phase: SemesterPhase): HeroMode {
  return phase === "finals" ? "finals" : "usual";
}

export interface Candidate {
  id: string;
  lat: number;
  lng: number;
  open_now: boolean;
  /** Minutes from now until it closes; null when it is shut. */
  closes_in_min: number | null;
  outlet_count: number | null;
  camp_ok: boolean;
  /** How many people the viewer actually knows — friends, and themself —
   *  have it in their ordered list. This is the tier, not a tiebreak. */
  friend_count: number;
  /** Mean rank percentile across the viewer's own and their friends' lists
   *  ONLY — 0 when nobody they know has ranked it. No stranger is in it. */
  friend_score: number;
  /** How many of those lists it appears in. */
  friend_sample: number;
  /** The same percentile with every list counted once — the crowd baseline.
   *  Carried on the row so the page can SHOW you the order you are not
   *  being given, which is the only honest way to claim your friends
   *  outrank it. */
  crowd_score: number;
  crowd_sample: number;
}

export type Placed<T> = T & { distance_m: number; walk_min: number };

/**
 * Distance from a momentary position read. The position is an argument and
 * never a stored field: nothing in this module, or downstream of it, writes
 * a coordinate anywhere (decision 12 — no persistent location history).
 */
export function place<T extends { lat: number; lng: number }>(shops: T[], at: LatLng): Array<Placed<T>> {
  return shops.map((s) => {
    const distance_m = Math.round(haversineMeters(at, s));
    return { ...s, distance_m, walk_min: walkingMinutes(distance_m) };
  });
}

/** Near me, open now, has outlets — the whole hero query, in one predicate. */
export function heroMatches<T extends Candidate>(placed: Array<Placed<T>>): Array<Placed<T>> {
  return placed.filter(
    (s) => s.open_now && (s.outlet_count ?? 0) > 0 && s.walk_min <= NEAR_ME_MAX_WALK_MIN,
  );
}

/**
 * Nearest first; a tie inside the same walking minute goes to your friends,
 * then to the crowd, and only then to raw metres. Three places sit within
 * three minutes of the Oval, so this tie is the common case, not the edge —
 * and eleven metres is not a reason to send somebody anywhere.
 */
function byUsual<T extends Candidate>(a: Placed<T>, b: Placed<T>): number {
  return (
    a.walk_min - b.walk_min ||
    b.friend_score - a.friend_score ||
    b.crowd_score - a.crowd_score ||
    a.distance_m - b.distance_m ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Finals week: you are not getting a coffee, you are finding somewhere to
 * sit for four hours. Somewhere you can stay outranks somewhere close, and
 * among those the one open longest wins.
 */
function byFinals<T extends Candidate>(a: Placed<T>, b: Placed<T>): number {
  return (
    Number(b.camp_ok) - Number(a.camp_ok) ||
    (b.closes_in_min ?? 0) - (a.closes_in_min ?? 0) ||
    a.walk_min - b.walk_min ||
    b.friend_score - a.friend_score ||
    b.crowd_score - a.crowd_score ||
    a.id.localeCompare(b.id)
  );
}

export function heroPick<T extends Candidate>(
  placed: Array<Placed<T>>,
  mode: HeroMode = "usual",
): Placed<T> | null {
  const matches = heroMatches(placed);
  if (matches.length === 0) return null;
  return [...matches].sort(mode === "finals" ? byFinals : byUsual)[0];
}

/**
 * The order Home reads in — lexicographic, your people first:
 *
 *   1. Has anybody you'd actually ask put it in order? (friends, and you)
 *   2. If so, how highly do THEY rank it — a mean over their lists only,
 *      with no stranger in the arithmetic at all.
 *   3. Otherwise, and to break their ties, the crowd baseline.
 *   4. Then the walk, then the id, so the order is total and stable.
 *
 * Keys 1 and 2 are separate because a place a friend ranked LAST scores 0.0
 * for them, exactly like a place they have never been — and those two are
 * not the same statement.
 *
 * This is deliberately not a weighted blend of friends and crowd, which is
 * how decision 8 first described it. "Friends outrank the crowd" (brief #8)
 * is an invariant, and a weighted mean cannot hold one: at any fixed weight
 * enough strangers outvote your friends, so the guarantee fails exactly when
 * a campus gets dense — which is the moat. Lexicographic holds at any crowd
 * size, and `discover.test.ts` proves it against a unanimous fifty.
 *
 * The cost is honest and visible: a place one friend ranked near the bottom
 * still leads a place the whole campus loves and nobody you know has been
 * to. Every row says which it is, in names.
 */
export function discoveryOrder<T extends Candidate>(placed: Array<Placed<T>>): Array<Placed<T>> {
  return [...placed].sort(
    (a, b) =>
      Number(b.friend_count > 0) - Number(a.friend_count > 0) ||
      b.friend_score - a.friend_score ||
      b.crowd_score - a.crowd_score ||
      b.friend_sample - a.friend_sample ||
      a.walk_min - b.walk_min ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The same column as the crowd would have it: every list counted once, no
 * tier, nobody you know weighted above anybody you don't. Home can toggle to
 * this, which is what turns "friends outrank the crowd" from a claim in a
 * test file into something a person can look at.
 */
export function crowdOrder<T extends Candidate>(placed: Array<Placed<T>>): Array<Placed<T>> {
  return [...placed].sort(
    (a, b) =>
      b.crowd_score - a.crowd_score ||
      b.crowd_sample - a.crowd_sample ||
      a.walk_min - b.walk_min ||
      a.id.localeCompare(b.id),
  );
}

/** How many places sit somewhere else in the second order than the first. */
export function movedBetween(a: Array<{ id: string }>, b: Array<{ id: string }>): number {
  const where = new Map(b.map((x, i) => [x.id, i]));
  return a.filter((x, i) => where.get(x.id) !== i).length;
}

/** Still open in `minutes` time — the finals-week "who's still up" section. */
export function stillOpenIn<T extends Candidate>(
  placed: Array<Placed<T>>,
  minutes: number,
): Array<Placed<T>> {
  return placed
    .filter((s) => s.open_now && (s.closes_in_min ?? 0) >= minutes)
    .sort((a, b) => (b.closes_in_min ?? 0) - (a.closes_in_min ?? 0) || a.id.localeCompare(b.id));
}
