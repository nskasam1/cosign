// The log flow's rules, without React: what a draft has to carry before each
// step is reachable, and which optional confirmations a given visit is worth
// asking about. Decision 4 budgets the whole flow at ≤ 8 taps and ≤ 10 s, so
// those choices are made here — testable — rather than inside the screens.
//
// Pure: no node built-ins, no DOM, no randomness. Same draft in, same
// questions out, every time.

import type {
  CrowdLevel,
  IntentTag,
  LogTapKey,
  LogTaps,
  NoiseLevel,
  ShopAmenities,
} from "@/types/cosign";

export type LogStep = "where" | "why" | "noise" | "crowd" | "review" | "extras";

/** The chain, in order. "extras" is a branch off review — the optional photo
 *  and one line — not a link in it, so it is deliberately absent here. */
export const LOG_STEPS: LogStep[] = ["where", "why", "noise", "crowd", "review"];

export interface LogDraft {
  shopId: string | null;
  intent: IntentTag | null;
  /** null after "Didn't notice" as well as before the question — hence the
   *  companion flags: skipping is an answer, and must not re-ask forever. */
  noise: NoiseLevel | null;
  crowd: CrowdLevel | null;
  noiseAnswered: boolean;
  crowdAnswered: boolean;
  taps: LogTaps;
  line: string;
  photo: string | null;
}

export function emptyDraft(shopId?: string | null): LogDraft {
  return {
    shopId: shopId ?? null,
    intent: null,
    noise: null,
    crowd: null,
    noiseAnswered: false,
    crowdAnswered: false,
    taps: {},
    line: "",
    photo: null,
  };
}

/** The four questions the chain asks, in order, each paired with the draft
 *  field that records its answer. A step is reachable once every question
 *  before it has one — that single rule is both functions below. */
const QUESTIONS: Array<{ step: LogStep; answered: (d: LogDraft) => boolean }> = [
  { step: "where", answered: (d) => Boolean(d.shopId) },
  { step: "why", answered: (d) => d.intent !== null },
  { step: "noise", answered: (d) => d.noiseAnswered },
  { step: "crowd", answered: (d) => d.crowdAnswered },
];

export function stepAllowed(step: LogStep, draft: LogDraft): boolean {
  const i = QUESTIONS.findIndex((q) => q.step === step);
  // review and extras aren't questions; both need all four answered
  const before = i === -1 ? QUESTIONS.length : i;
  return QUESTIONS.slice(0, before).every((q) => q.answered(draft));
}

export function firstIncompleteStep(draft: LogDraft): LogStep {
  return QUESTIONS.find((q) => !q.answered(draft))?.step ?? "review";
}

/** Outlets are only worth confirming when you came to plug something in. */
const OUTLET_INTENTS: IntentTag[] = [
  "deep_work",
  "group_project",
  "reading",
  "killing_time",
  "late_night",
];

const WIFI_INTENTS: IntentTag[] = ["deep_work", "group_project", "reading"];

const CAMP_INTENTS: IntentTag[] = ["deep_work", "group_project", "reading", "late_night"];

/** The cap is what makes the flow worst case 8 taps by construction rather
 *  than by hope: 6 required taps + at most 2 discretionary. */
const MAX_CONFIRMATIONS = 2;

/**
 * The confirmations this visit can ask for: the first two that qualify, in a
 * fixed order. Each is a yes/no observation about a fact the shop claims —
 * never a judgement, never a scale.
 */
export function confirmationsFor(
  intent: IntentTag | null,
  crowd: CrowdLevel | null,
  amenities: ShopAmenities | null,
): LogTapKey[] {
  const asks: Array<[LogTapKey, boolean]> = [
    ["found_outlet", (amenities?.outlet_count ?? 0) > 0 && OUTLET_INTENTS.includes(intent)],
    ["wifi_held_up", amenities?.wifi_mbps != null && WIFI_INTENTS.includes(intent)],
    // a table is only news when the room wasn't empty
    ["got_a_table", crowd === "comfortable" || crowd === "packed"],
    ["would_camp", Boolean(amenities?.camp_ok) && CAMP_INTENTS.includes(intent)],
  ];
  return asks
    .filter(([, qualifies]) => qualifies)
    .slice(0, MAX_CONFIRMATIONS)
    .map(([key]) => key);
}

/** Worst-case better/worse taps to place one shop into a list of n
 *  (insertion.ts's bound), so the UI can promise "at most N" up front. */
export function comparisonBound(n: number): number {
  return Math.ceil(Math.log2(n + 1));
}
