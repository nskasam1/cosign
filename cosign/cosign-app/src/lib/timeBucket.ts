import type { TimeBucket } from "@/types/cosign";

/**
 * The bucket an hour of the day falls in. Separated from the clock so the
 * server can ask about an hour in the CAMPUS's timezone (which is how it
 * decides whether a shop is open) rather than in the process's — one
 * definition, two entry points.
 */
export function timeBucketForHour(hour: number): TimeBucket {
  if (hour >= 22 || hour < 5) return "late_night"; // 10pm–4:59am
  if (hour < 11) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

// Maps the viewer's local clock to the snapshot bucket a shop's detail
// page should default to (Phase 1 schema note: "defaulting to whichever
// bucket matches the viewer's current local time").
export function currentTimeBucket(date: Date = new Date()): TimeBucket {
  return timeBucketForHour(date.getHours());
}

// Staleness lives in src/lib/freshness.ts (Phase 4), next to the data-age
// labels it shares its threshold with. Deliberately not re-exported from
// here: one definition, one import path.
