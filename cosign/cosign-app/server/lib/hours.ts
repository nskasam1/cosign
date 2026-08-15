// Open-now logic over shop_hours rows. Times are minutes since local
// midnight; close_min > 1440 means the window runs past midnight into the
// next day (Night Owl closes at 2am → close_min 1560). A shop is open at
// minute m on day d if a window on day d covers m, or a window on day d-1
// overflows past midnight to cover m.

export interface HoursRow {
  day: number; // 0 = Sunday
  open_min: number;
  close_min: number;
}

export function isOpenAt(rows: HoursRow[], day: number, minute: number): boolean {
  const prevDay = (day + 6) % 7;
  for (const r of rows) {
    if (r.day === day && r.open_min <= minute && minute < Math.min(r.close_min, 1440)) {
      return true;
    }
    if (r.day === prevDay && r.close_min > 1440 && minute < r.close_min - 1440) {
      return true;
    }
  }
  return false;
}

/** Day-of-week (0=Sunday) and minutes-since-midnight in a timezone. */
export function localDayMinute(date: Date, timezone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days.indexOf(get("weekday"));
  const hour = Number(get("hour")) % 24; // "24" at midnight in some ICU versions
  return { day, minute: hour * 60 + Number(get("minute")) };
}

/** Parse "HH:MM" (00:00–24:00) to minutes. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Convert a seed hours entry ({days, open, close}) into per-day rows.
 * close <= open means the window runs past midnight (close "02:00" → 1560);
 * close "24:00" stays 1440.
 */
export function seedHoursToRows(entries: Array<{ days: number[]; open: string; close: string }>): HoursRow[] {
  const rows: HoursRow[] = [];
  for (const e of entries) {
    const open = toMinutes(e.open);
    let close = toMinutes(e.close);
    if (close <= open && close !== 1440) close += 1440;
    for (const day of e.days) rows.push({ day, open_min: open, close_min: close });
  }
  return rows;
}

/** Human label for a shop's hours today, e.g. "7:00 AM – 2:00 AM". */
export function formatWindow(open_min: number, close_min: number): string {
  const fmt = (m: number) => {
    const mm = ((m % 1440) + 1440) % 1440;
    const h24 = Math.floor(mm / 60);
    const min = mm % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const ampm = h24 < 12 ? "AM" : "PM";
    return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
  };
  if (open_min === 0 && close_min >= 1440) return "Open 24 hours";
  return `${fmt(open_min)} – ${fmt(close_min)}`;
}
