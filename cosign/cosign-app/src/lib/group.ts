// Group decision mode (brief #8, decision 8): four people, one table that
// works for all of them.
//
// Pure — no DB, no DOM, no clock of its own — so the server computes it and
// the tests can move the group, the places and the hour around underneath it.
//
// It is NOT a vote. Nobody ranks anybody else's suggestion, nobody scores
// anything, and there is no tally anywhere in this file. Each person taps
// what they NEED; the needs union into a set of constraints every candidate
// must satisfy; and the survivors are ordered by what the group's own ranked
// lists already say. A vote would be a rating with extra steps, which is the
// one input class this product does not have.

import type { IntentTag, NoiseLevel, TableSize } from "@/types/cosign";

/** Decision 8's cap. A fifth person is a different problem. */
export const MAX_PARTICIPANTS = 4;

/** A party of three cannot sit at a counter, whoever tapped what. */
export const GROUP_TABLE_MIN_PARTY = 3;

/** One person's answer. The only thing a participant ever gives. */
export interface GroupNeed {
  /** Session-scoped identity — an anonymous browser token, never a login. */
  participant: string;
  display_name: string | null;
  /** Null for somebody who joined by link: they bring needs, not a list. */
  user_id: string | null;
  intent_tag: IntentTag | null;
  outlets: boolean;
  open_now: boolean;
  wifi: boolean;
  /** "This is as loud as I can take." The strictest across the group wins. */
  max_noise: NoiseLevel | null;
}

/** Where one member has a place in their own ordered list. */
export interface MemberPosition {
  user_id: string;
  position: number;
  /** How long that member's list is — a #3 of 4 is not a #3 of 22. */
  of: number;
}

export interface GroupPlace {
  id: string;
  name: string;
  open_now: boolean;
  outlet_count: number | null;
  wifi_mbps: number | null;
  table_size: TableSize | null;
  /**
   * How loud people have actually logged it AT THIS TIME OF DAY — never a
   * shop column, because loudness is not a property a shop can be asked to
   * declare about itself. Null means nobody has logged this hour, which is
   * an absence of evidence and is treated as one.
   */
  noise: NoiseLevel | null;
  noise_samples: number;
  walk_min: number;
  /** Only the members who have actually ranked it. */
  positions: MemberPosition[];
}

export type ConstraintKey = "open_now" | "outlets" | "wifi" | "noise" | "table";

export interface Constraint {
  key: ConstraintKey;
  /** Participant tokens. Empty for `table`, which nobody has to ask for. */
  askedBy: string[];
  /** Enough detail to print: "outlets for two", "no louder than quiet". */
  detail: string;
}

const NOISE_ORDER: Record<NoiseLevel, number> = { quiet: 0, conversational: 1, loud: 2 };

/** The strictest ceiling anybody in the group set, or null if nobody did. */
export function strictestNoise(needs: GroupNeed[]): NoiseLevel | null {
  let out: NoiseLevel | null = null;
  for (const n of needs) {
    if (!n.max_noise) continue;
    if (!out || NOISE_ORDER[n.max_noise] < NOISE_ORDER[out]) out = n.max_noise;
  }
  return out;
}

/**
 * The union of what the group needs — this is the "intersection" of the
 * brief, seen from the other side: every constraint anybody asked for has to
 * hold at once, so the set of acceptable places is the intersection of each
 * person's acceptable set.
 *
 * `outlets` counts the people who asked: four people who all need to plug in
 * need four outlets, not one. Nothing else scales with the party except the
 * table, which nobody has to ask for because everybody needs it.
 */
export function constraintsFor(needs: GroupNeed[]): Constraint[] {
  const out: Constraint[] = [];
  const asked = (pick: (n: GroupNeed) => boolean) => needs.filter(pick).map((n) => n.participant);

  const openNow = asked((n) => n.open_now);
  if (openNow.length) out.push({ key: "open_now", askedBy: openNow, detail: "open now" });

  const outlets = asked((n) => n.outlets);
  if (outlets.length) {
    out.push({
      key: "outlets",
      askedBy: outlets,
      detail: outlets.length === 1 ? "an outlet" : `${outlets.length} outlets`,
    });
  }

  const wifi = asked((n) => n.wifi);
  if (wifi.length) out.push({ key: "wifi", askedBy: wifi, detail: "wifi" });

  const noise = strictestNoise(needs);
  if (noise) {
    out.push({
      key: "noise",
      askedBy: asked((n) => n.max_noise === noise),
      detail: noise === "quiet" ? "quiet" : `no louder than ${noise}`,
    });
  }

  if (needs.length >= GROUP_TABLE_MIN_PARTY) {
    out.push({ key: "table", askedBy: [], detail: `a table for ${needs.length}` });
  }
  return out;
}

/**
 * Does one place satisfy one constraint?
 *
 * `noise` is the only one that can answer "I don't know", and it says so
 * rather than passing: a place nobody has logged at this hour has not earned
 * a claim about how loud it is. Those places are collected separately (see
 * `unvouched`) instead of being silently dropped or silently allowed.
 */
export function meets(place: GroupPlace, c: Constraint, needs: GroupNeed[]): boolean | "unknown" {
  switch (c.key) {
    case "open_now":
      return place.open_now;
    case "outlets":
      return (place.outlet_count ?? 0) >= c.askedBy.length;
    case "wifi":
      return (place.wifi_mbps ?? 0) > 0;
    case "table":
      return place.table_size !== "mug_only";
    case "noise": {
      const ceiling = strictestNoise(needs);
      if (!ceiling) return true;
      if (!place.noise) return "unknown";
      return NOISE_ORDER[place.noise] <= NOISE_ORDER[ceiling];
    }
  }
}

/**
 * The line between "nobody here objects" and "somebody is putting up with
 * it": a place nobody in the room has in the bottom half of their own
 * ordering. It is a threshold on a POSITION, not on a score — the sentence
 * it stands for is one a person can check against their own list.
 */
export const NOBODY_OBJECTS = 0.5;

/** A survivor, with what the group's own lists say about it. */
export interface GroupPick {
  place: GroupPlace;
  /** How many members have it in their ordered list at all. */
  coverage: number;
  /** The member who has it LOWEST — the one making the compromise. */
  worst: MemberPosition | null;
  /** That member's percentile: 1.0 = their #1, 0.0 = their last. */
  worstPct: number;
  /** Nobody in the room has it in the bottom half of their own list. */
  unobjectionable: boolean;
}

export interface RuledOut {
  place: GroupPlace;
  failed: ConstraintKey[];
}

export interface GroupAnswer {
  party: number;
  constraints: Constraint[];
  /** Best first. Empty when nothing satisfies everything. */
  picks: GroupPick[];
  /**
   * Satisfies every constraint, but nobody in the group has ever put it in
   * order — so there is no group signal to rank it by and it is offered as
   * what it is rather than sorted in among places people have opinions about.
   */
  unknownToAll: GroupPlace[];
  ruledOut: RuledOut[];
  /** Would have qualified, but nobody has logged how loud it gets this hour. */
  unvouched: GroupPlace[];
  /**
   * When nothing survives: the one constraint whose removal frees the most
   * places, so the page can name what is actually costing the group rather
   * than shrugging. Null when there is an answer, or when dropping any single
   * constraint still leaves nothing.
   */
  costliest: { key: ConstraintKey; detail: string; unlocks: number } | null;
}

/** 1.0 for a #1, 0.0 for a last place, 1.0 for a list of one. */
function percentile(position: number, of: number): number {
  return of <= 1 ? 1 : 1 - (position - 1) / (of - 1);
}

function pickOf(place: GroupPlace): GroupPick {
  let worst: MemberPosition | null = null;
  let worstPct = 1;
  for (const p of place.positions) {
    const pct = percentile(p.position, p.of);
    // Ties broken by id, not by arrival: two people can both have it last,
    // and which one the page names must not depend on who answered first.
    if (!worst || pct < worstPct || (pct === worstPct && p.user_id < worst.user_id)) {
      worst = p;
      worstPct = pct;
    }
  }
  const pct = worst ? worstPct : 0;
  return {
    place,
    coverage: place.positions.length,
    worst,
    worstPct: pct,
    unobjectionable: !!worst && pct >= NOBODY_OBJECTS,
  };
}

/**
 * The order among the places that satisfy everything and that somebody in
 * the group has actually put in order.
 *
 *   1. Does anybody in the room object — is it in the bottom half of any
 *      member's own list? Everything nobody objects to comes first.
 *   2. Inside that band, how many of the group have ranked it at all: two
 *      people who both rank it well is a better answer than one person's
 *      favourite that nobody else has been to.
 *   3. Then the worst position it holds — the member making the biggest
 *      compromise, maximised.
 *   4. Then the walk, then the id, so the order is total and stable.
 *
 * Both orderings this replaced are worth remembering, because each was wrong
 * in the opposite direction and the seeded campus caught both:
 *   * coverage first answered with the place all four had been to and one of
 *     them ranks LAST of ten — more evidence is not less objection;
 *   * the worst position first answered with one person's #2 that nobody
 *     else had heard of, over the place two of them had in their top four —
 *     less objection is not more agreement.
 * The band is what separates the two questions: first "is anyone putting up
 * with this", then "how many of us actually want it".
 *
 * A member who has never been is neutral, not a zero — the same distinction
 * Phase 4 drew on Home, and for the same reason: "I have not been" and "I
 * rank it last" are not the same statement. Both are visible in the answer,
 * which prints who has it where and who has never been, so a thin agreement
 * cannot pass itself off as a thick one.
 */
export function byGroupFit(a: GroupPick, b: GroupPick): number {
  return (
    Number(b.unobjectionable) - Number(a.unobjectionable) ||
    b.coverage - a.coverage ||
    b.worstPct - a.worstPct ||
    a.place.walk_min - b.place.walk_min ||
    a.place.id.localeCompare(b.place.id)
  );
}

export function intersect(needs: GroupNeed[], places: GroupPlace[]): GroupAnswer {
  const constraints = constraintsFor(needs);
  const picks: GroupPick[] = [];
  const unknownToAll: GroupPlace[] = [];
  const ruledOut: RuledOut[] = [];
  const unvouched: GroupPlace[] = [];

  for (const place of places) {
    const failed: ConstraintKey[] = [];
    let unknown = false;
    for (const c of constraints) {
      const verdict = meets(place, c, needs);
      if (verdict === "unknown") unknown = true;
      else if (!verdict) failed.push(c.key);
    }
    if (failed.length) ruledOut.push({ place, failed });
    else if (unknown) unvouched.push(place);
    else if (place.positions.length === 0) unknownToAll.push(place);
    else picks.push(pickOf(place));
  }

  picks.sort(byGroupFit);
  const byWalk = (a: GroupPlace, b: GroupPlace) => a.walk_min - b.walk_min || a.id.localeCompare(b.id);
  unknownToAll.sort(byWalk);
  unvouched.sort(byWalk);
  ruledOut.sort((a, b) => a.failed.length - b.failed.length || a.place.id.localeCompare(b.place.id));

  return {
    party: needs.length,
    constraints,
    picks,
    unknownToAll,
    ruledOut,
    unvouched,
    // Nothing anybody has an opinion about AND nothing that merely fits: the
    // group is genuinely stuck, and only then is it worth naming the cost.
    costliest: picks.length || unknownToAll.length ? null : costliestConstraint(needs, places),
  };
}

/**
 * Which single constraint is standing between this group and somewhere to
 * sit. Answers the only useful question an empty result can be asked, and
 * lets the page name a person's need rather than blaming "your filters" —
 * nobody set a filter, four people said what they needed.
 *
 * Ties go to the constraint the fewest people asked for: telling three people
 * to give up wifi when dropping one person's "quiet" would do is the wrong
 * suggestion even when it frees the same number of tables.
 */
export function costliestConstraint(
  needs: GroupNeed[],
  places: GroupPlace[],
): { key: ConstraintKey; detail: string; unlocks: number } | null {
  const all = constraintsFor(needs);
  let best: { key: ConstraintKey; detail: string; unlocks: number; askedBy: number } | null = null;
  for (const dropped of all) {
    // `table` is not anybody's to drop — a party of four cannot un-need a
    // table — so it is never offered as the thing to give up.
    if (dropped.key === "table") continue;
    const rest = all.filter((c) => c.key !== dropped.key);
    const unlocks = places.filter((p) => rest.every((c) => meets(p, c, needs) === true)).length;
    if (unlocks === 0) continue;
    const askedBy = dropped.askedBy.length;
    const better = !best || unlocks > best.unlocks || (unlocks === best.unlocks && askedBy < best.askedBy);
    if (better) best = { key: dropped.key, detail: dropped.detail, unlocks, askedBy };
  }
  return best && { key: best.key, detail: best.detail, unlocks: best.unlocks };
}

/**
 * How the campus became the answer, one constraint at a time.
 *
 * The count each need is *on its own* responsible for is the wrong number to
 * print: two needs that rule out the same eight places would each claim
 * eight, and the arithmetic would not add up on the page. This walks the
 * constraints in a fixed order and reports what each one took off a table
 * the previous ones had already narrowed — so the column subtracts to the
 * answer, and a need that cost nothing says so, which is the only way anybody
 * learns which of their needs is cheap.
 */
export const FUNNEL_ORDER: ConstraintKey[] = ["open_now", "table", "outlets", "wifi", "noise"];

export interface FunnelStep {
  key: ConstraintKey;
  detail: string;
  askedBy: string[];
  removed: number;
  remaining: number;
}

export function funnel(
  needs: GroupNeed[],
  places: GroupPlace[],
): { total: number; steps: FunnelStep[]; held: number; left: number } {
  const constraints = constraintsFor(needs);
  const ordered = FUNNEL_ORDER.flatMap((k) => constraints.filter((c) => c.key === k));
  let alive = places;
  const steps: FunnelStep[] = [];
  for (const c of ordered) {
    // "unknown" survives this pass: an unlogged room has not failed the
    // question, it has declined to answer it, and it is counted separately.
    const next = alive.filter((p) => meets(p, c, needs) !== false);
    steps.push({
      key: c.key,
      detail: c.detail,
      askedBy: c.askedBy,
      removed: alive.length - next.length,
      remaining: next.length,
    });
    alive = next;
  }
  const held = alive.filter((p) => constraints.some((c) => meets(p, c, needs) === "unknown")).length;
  return { total: places.length, steps, held, left: alive.length - held };
}

/**
 * The places that fail exactly one thing somebody asked for — the most
 * useful thing an answer page can say after the answer, because it is where
 * somebody finds out that the reason they are not at their own favourite is
 * one named person's one named need.
 *
 * Ordered by how many of the group have it in their list, then how highly,
 * then the walk: "your three favourites" rather than three arbitrary misses.
 */
export function oneNeedAway(answer: GroupAnswer): Array<{ place: GroupPlace; key: ConstraintKey }> {
  return answer.ruledOut
    .filter((r) => r.failed.length === 1 && r.place.positions.length > 0)
    .map((r) => ({ ...r, pick: pickOf(r.place) }))
    .sort((a, b) => b.pick.coverage - a.pick.coverage || b.pick.worstPct - a.pick.worstPct || a.place.walk_min - b.place.walk_min)
    .map((r) => ({ place: r.place, key: r.failed[0] }));
}

/**
 * What each need is worth, priced one at a time — INCLUDING the ones worth
 * nothing, which is the rarest and most useful line an empty page has: it
 * tells somebody which sacrifice would buy the table exactly nothing.
 */
export function priceOfEachNeed(
  needs: GroupNeed[],
  places: GroupPlace[],
): Array<{ key: ConstraintKey; detail: string; askedBy: string[]; unlocks: number; example: GroupPlace | null }> {
  const all = constraintsFor(needs);
  return all
    // A party of four cannot un-need a table, so it is never priced.
    .filter((c) => c.key !== "table")
    .map((dropped) => {
      const rest = all.filter((c) => c.key !== dropped.key);
      const freed = places.filter((p) => rest.every((c) => meets(p, c, needs) === true));
      const best = freed.map(pickOf).sort(byGroupFit)[0];
      return {
        key: dropped.key,
        detail: dropped.detail,
        askedBy: dropped.askedBy,
        unlocks: freed.length,
        example: best?.place ?? freed[0] ?? null,
      };
    })
    .sort((a, b) => b.unlocks - a.unlocks || a.key.localeCompare(b.key));
}

/** Everyone who has answered, in the order they arrived. */
export function answeredBy(needs: GroupNeed[]): string[] {
  return needs.map((n) => n.display_name ?? "Someone");
}

export type SessionState = "alone" | "partial" | "complete";

/**
 * A group of one is a search, so nothing is answered until two people have
 * spoken. Past that the answer exists and is honest about being provisional
 * until everybody who was asked has said something — it can still move, and
 * the page says so rather than pretending the third person will not matter.
 */
export function sessionState(answered: number, invited: number): SessionState {
  if (answered < 2) return "alone";
  return answered >= Math.min(Math.max(invited, 1), MAX_PARTICIPANTS) ? "complete" : "partial";
}
