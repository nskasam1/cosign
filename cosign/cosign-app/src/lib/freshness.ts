// Freshness (brief #10): show how old the data is, and prompt a re-verify
// when someone comes back to a place whose facts have gone stale.
//
// Pure, and deliberately timezone-free: `last_verified_at` is an ISO string
// that already carries the shop's own offset ("2026-03-28T13:45:00-04:00"),
// so the month a human would name comes from the string's own date part.
// Deriving it through the viewer's clock would rename March as February for
// anyone west of the shop.

export const STALE_AFTER_DAYS = 60;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface DataAge {
  /** Fractional days since the last check; null when never checked. */
  days: number | null;
  stale: boolean;
  /** A clause, not a sentence: "checked 4 days ago", "not checked since March". */
  label: string;
}

export function ageInDays(lastVerifiedAt: string | null, now: Date = new Date()): number | null {
  if (!lastVerifiedAt) return null;
  const t = new Date(lastVerifiedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 86_400_000;
}

export function isStale(lastVerifiedAt: string | null, now: Date = new Date()): boolean {
  const days = ageInDays(lastVerifiedAt, now);
  return days === null || days > STALE_AFTER_DAYS;
}

/** "March" / "March 2025" — the month a person would say, from the shop's own date. */
function monthOf(lastVerifiedAt: string, now: Date): string {
  const year = Number(lastVerifiedAt.slice(0, 4));
  const month = MONTHS[Number(lastVerifiedAt.slice(5, 7)) - 1] ?? "";
  return year === now.getFullYear() ? month : `${month} ${year}`;
}

export function dataAge(lastVerifiedAt: string | null, now: Date = new Date()): DataAge {
  const days = ageInDays(lastVerifiedAt, now);
  if (days === null || lastVerifiedAt === null) {
    return { days: null, stale: true, label: "never checked" };
  }
  const stale = days > STALE_AFTER_DAYS;
  // Past the staleness line the exact number stops being the point — what
  // matters is that it has been a season, so the label names the month.
  if (stale) return { days, stale, label: `not checked since ${monthOf(lastVerifiedAt, now)}` };
  if (days < 1) return { days, stale, label: "checked today" };
  if (days < 2) return { days, stale, label: "checked yesterday" };
  if (days < 7) return { days, stale, label: `checked ${Math.floor(days)} days ago` };
  if (days < 14) return { days, stale, label: "checked a week ago" };
  return { days, stale, label: `checked ${Math.floor(days / 7)} weeks ago` };
}
