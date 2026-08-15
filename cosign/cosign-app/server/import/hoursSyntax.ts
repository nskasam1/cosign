// The founder-facing compact hours syntax from seed/IMPORT_FORMAT.md:
//   "Mo-Fr 07:00-21:00; Sa-Su 08:00-22:00"
//   "Su closed" · split days "Mo-Fr 07:00-11:30, 15:00-21:00"
//   past midnight "Fr-Sa 08:00-02:00" · 24h "00:00-24:00"
// Parses to the seed JSON hours shape ({days, open, close}) and formats
// back. Days are 0=Sunday everywhere in the data model.

export interface HoursEntry {
  days: number[];
  open: string; // "HH:MM"
  close: string; // "HH:MM", "24:00" allowed; close <= open means next day
}

const DAY_TOKENS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseDayRange(spec: string): number[] {
  const m = spec.match(/^([A-Z][a-z])(?:-([A-Z][a-z]))?$/);
  if (!m) throw new Error(`bad day spec: "${spec}"`);
  const from = DAY_TOKENS.indexOf(m[1]);
  if (from === -1) throw new Error(`unknown day: "${m[1]}"`);
  if (!m[2]) return [from];
  const to = DAY_TOKENS.indexOf(m[2]);
  if (to === -1) throw new Error(`unknown day: "${m[2]}"`);
  const days: number[] = [];
  let d = from;
  while (true) {
    days.push(d);
    if (d === to) break;
    d = (d + 1) % 7;
    if (days.length > 7) throw new Error(`day range never closes: "${spec}"`);
  }
  return days;
}

const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;

function checkTime(t: string, ctx: string): string {
  if (!TIME_RE.test(t) || (t.startsWith("24") && t !== "24:00")) {
    throw new Error(`bad time "${t}" in "${ctx}"`);
  }
  return t;
}

/** Parse the compact syntax into seed hours entries. */
export function parseHoursSyntax(input: string): HoursEntry[] {
  const entries: HoursEntry[] = [];
  for (const rawSegment of input.split(";")) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    const m = segment.match(/^(\S+)\s+(.+)$/);
    if (!m) throw new Error(`bad hours segment: "${segment}"`);
    const days = parseDayRange(m[1]);
    const windows = m[2].trim();
    if (windows.toLowerCase() === "closed") continue; // closed = no entries
    for (const rawWindow of windows.split(",")) {
      const w = rawWindow.trim();
      const t = w.match(/^(\S+)-(\S+)$/);
      if (!t) throw new Error(`bad time window "${w}" in "${segment}"`);
      entries.push({ days, open: checkTime(t[1], segment), close: checkTime(t[2], segment) });
    }
  }
  return entries;
}

/** Format seed hours entries back into the compact syntax. */
export function formatHoursSyntax(entries: HoursEntry[]): string {
  // build per-day window lists, then merge display-consecutive equal days
  const perDay = new Map<number, string[]>();
  for (const e of entries) {
    for (const d of e.days) {
      if (!perDay.has(d)) perDay.set(d, []);
      perDay.get(d)!.push(`${e.open}-${e.close}`);
    }
  }
  const segments: string[] = [];
  const done = new Set<number>();
  // walk Mo..Su in display order starting Monday for readability
  const displayOrder = [1, 2, 3, 4, 5, 6, 0];
  for (const d of displayOrder) {
    if (done.has(d) || !perDay.has(d)) continue;
    const windows = perDay.get(d)!.join(", ");
    // collect the run of consecutive display-order days with same windows
    const run = [d];
    let idx = displayOrder.indexOf(d);
    while (idx + 1 < displayOrder.length) {
      const next = displayOrder[idx + 1];
      if (perDay.has(next) && !done.has(next) && perDay.get(next)!.join(", ") === windows) {
        run.push(next);
        idx++;
      } else break;
    }
    run.forEach((x) => done.add(x));
    const label =
      run.length === 1 ? DAY_TOKENS[run[0]] : `${DAY_TOKENS[run[0]]}-${DAY_TOKENS[run[run.length - 1]]}`;
    segments.push(`${label} ${windows}`);
  }
  return segments.join("; ");
}
