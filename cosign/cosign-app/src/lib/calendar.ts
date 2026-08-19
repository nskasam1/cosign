// Semester awareness from the committed academic calendar
// (seed/academic-calendar.json). Pure functions over an injected calendar:
// the server loads the JSON from disk and stamps logs / serves /api/meta;
// the SPA gets derived values from the API, so no JSON import is needed in
// client code. All comparisons happen on local calendar dates in the
// school's timezone (fixes the old semester.ts UTC off-by-one).

import type { SemesterPhase } from "@/types/cosign";

export interface AcademicTerm {
  slug: string; // '2026-autumn'
  name: string;
  start: string; // 'YYYY-MM-DD' local
  end: string;
  week_one_end: string;
  finals_start: string;
}

export interface AcademicCalendar {
  school: string;
  timezone: string;
  terms: AcademicTerm[];
}

/** Local calendar date (YYYY-MM-DD) of `date` in the given IANA timezone. */
export function localDateString(date: Date, timezone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function termForDate(cal: AcademicCalendar, date: Date): AcademicTerm | null {
  const d = localDateString(date, cal.timezone);
  return cal.terms.find((t) => t.start <= d && d <= t.end) ?? null;
}

/** Semester value stamped on logs: term slug, or 'break' between terms. */
export function semesterForDate(cal: AcademicCalendar, date: Date): string {
  return termForDate(cal, date)?.slug ?? "break";
}

export function phaseForDate(cal: AcademicCalendar, date: Date): SemesterPhase {
  const term = termForDate(cal, date);
  if (!term) return "break";
  const d = localDateString(date, cal.timezone);
  if (d <= term.week_one_end) return "week_one";
  if (d >= term.finals_start) return "finals";
  return "mid_semester";
}
