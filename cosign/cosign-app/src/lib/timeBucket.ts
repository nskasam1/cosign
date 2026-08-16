import type { TimeBucket } from "@/types/cosign";

// Maps the viewer's local clock to the snapshot bucket a shop's detail
// page should default to (Phase 1 schema note: "defaulting to whichever
// bucket matches the viewer's current local time").
export function currentTimeBucket(date: Date = new Date()): TimeBucket {
  const hour = date.getHours();
  if (hour >= 22 || hour < 5) return "late_night"; // 10pm–4:59am
  if (hour < 11) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

// Staleness lives in src/lib/freshness.ts (Phase 4), next to the data-age
// labels it shares its threshold with. Deliberately not re-exported from
// here: one definition, one import path.
