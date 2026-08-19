// Binary-search insertion into an ordered list — the only ranking mechanic
// (decision 3). The candidate is compared against midpoints with plain
// better/worse taps until its slot is found: ≤ ceil(log2(n+1)) comparisons.
// Pure state machine: the UI (Phase 3) and the seed replay both drive it.
//
// Lists are ordered best (index 0) → worst. "Candidate wins" a comparison
// means the candidate ranks better than the opponent.

export interface InsertionState {
  candidate: string;
  list: string[]; // current ordered ids, best → worst (without candidate)
  lo: number; // inclusive lower bound of possible insert index
  hi: number; // exclusive upper bound
}

export function startInsertion(candidate: string, list: string[]): InsertionState {
  if (list.includes(candidate)) {
    throw new Error(`candidate ${candidate} already in list`);
  }
  return { candidate, list, lo: 0, hi: list.length };
}

export function isDone(state: InsertionState): boolean {
  return state.lo >= state.hi;
}

/** The midpoint opponent for the next better/worse tap, or null if placed. */
export function nextOpponent(state: InsertionState): string | null {
  if (isDone(state)) return null;
  return state.list[midIndex(state)];
}

function midIndex(state: InsertionState): number {
  return (state.lo + state.hi) >> 1;
}

/** Apply one tap. candidateWon = the user picked the candidate as better. */
export function applyComparison(state: InsertionState, candidateWon: boolean): InsertionState {
  if (isDone(state)) throw new Error("insertion already complete");
  const mid = midIndex(state);
  return candidateWon
    ? { ...state, hi: mid }
    : { ...state, lo: mid + 1 };
}

/** Final 0-based insert index; only valid once isDone(state). */
export function finalIndex(state: InsertionState): number {
  if (!isDone(state)) throw new Error("insertion not complete");
  return state.lo;
}

/** The completed list with the candidate placed. */
export function finalList(state: InsertionState): string[] {
  const i = finalIndex(state);
  return [...state.list.slice(0, i), state.candidate, ...state.list.slice(i)];
}

export interface ReplayedComparison {
  winner: string;
  loser: string;
}

/**
 * Replay an insertion when the candidate's correct slot is already known
 * (seed generation): emits exactly the better/worse taps a user whose final
 * order is ground truth would have made. targetIndex is the candidate's
 * index in the list *after* insertion.
 */
export function replayInsertion(
  candidate: string,
  list: string[],
  targetIndex: number,
): { comparisons: ReplayedComparison[]; list: string[] } {
  let state = startInsertion(candidate, list);
  const comparisons: ReplayedComparison[] = [];
  while (!isDone(state)) {
    const opponent = nextOpponent(state) as string;
    const mid = (state.lo + state.hi) >> 1;
    const candidateWon = targetIndex <= mid;
    comparisons.push(
      candidateWon
        ? { winner: candidate, loser: opponent }
        : { winner: opponent, loser: candidate },
    );
    state = applyComparison(state, candidateWon);
  }
  if (finalIndex(state) !== targetIndex) {
    throw new Error(
      `replay landed at ${finalIndex(state)}, expected ${targetIndex}`,
    );
  }
  return { comparisons, list: finalList(state) };
}
