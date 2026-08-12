export type SemesterPhase = "week_one" | "mid_semester" | "finals" | "break";

// Phase 5.2 — hardcoded per-school date ranges, per the brief ("can
// hardcode date ranges per school initially"). OSU only, since that's the
// only school seeded. THESE DATES ARE PLACEHOLDERS — replace with the real
// OSU academic calendar before relying on this for anything real.
const OSU_CALENDAR = {
  fall: { start: "2026-08-25", weekOneEnd: "2026-08-31", finalsStart: "2026-12-07", end: "2026-12-13" },
  spring: { start: "2027-01-11", weekOneEnd: "2027-01-17", finalsStart: "2027-04-19", end: "2027-04-25" },
};

export function currentSemesterPhase(date: Date = new Date()): SemesterPhase {
  const iso = date.toISOString().slice(0, 10);
  for (const term of Object.values(OSU_CALENDAR)) {
    if (iso < term.start || iso > term.end) continue;
    if (iso <= term.weekOneEnd) return "week_one";
    if (iso >= term.finalsStart) return "finals";
    return "mid_semester";
  }
  return "break";
}
