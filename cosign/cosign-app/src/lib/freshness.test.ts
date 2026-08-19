// @vitest-environment node
//
// Data-age labels (brief #10). The seed's `last_verified_at` values spread
// from March to August, so these labels are what the whole freshness story
// is told in — and the month one has a timezone trap in it.

import { describe, expect, it } from "vitest";
import { STALE_AFTER_DAYS, ageInDays, dataAge, isStale } from "./freshness";

const NOW = new Date("2026-08-15T12:00:00-04:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const label = (iso: string | null) => dataAge(iso, NOW).label;

describe("how old the data is", () => {
  it("counts days from the check to now", () => {
    expect(ageInDays(daysAgo(3), NOW)).toBeCloseTo(3, 6);
    expect(ageInDays(null, NOW)).toBeNull();
  });

  it("says it plainly, the way a person would", () => {
    expect(label(daysAgo(0.2))).toBe("checked today");
    expect(label(daysAgo(1.1))).toBe("checked yesterday");
    expect(label(daysAgo(4))).toBe("checked 4 days ago");
    expect(label(daysAgo(9))).toBe("checked a week ago");
    expect(label(daysAgo(21))).toBe("checked 3 weeks ago");
  });

  it("stops counting once it has been a season, and names the month instead", () => {
    // Cardinal & Vine in the seed: 2026-03-28, 140 days before today.
    expect(label("2026-03-28T13:45:00-04:00")).toBe("not checked since March");
    expect(label("2026-06-02T09:30:00-04:00")).toBe("not checked since June");
  });

  it("names the year too once it is not this one", () => {
    expect(label("2025-11-04T09:30:00-05:00")).toBe("not checked since November 2025");
  });

  it("reads the month off the shop's own date, never the viewer's clock", () => {
    // 2026-04-01T00:30-04:00 is 2026-03-31T20:30 in Denver and
    // 2026-04-01T04:30 in UTC. All three agree it was checked in April,
    // because the string carries the offset the shop was checked in.
    expect(label("2026-04-01T00:30:00-04:00")).toBe("not checked since April");
  });

  it("has a designed answer for a place nobody has ever checked", () => {
    expect(label(null)).toBe("never checked");
    expect(dataAge(null, NOW).stale).toBe(true);
    expect(dataAge(null, NOW).days).toBeNull();
  });
});

describe("the staleness line", () => {
  it("is sixty days, inclusive on the fresh side", () => {
    expect(STALE_AFTER_DAYS).toBe(60);
    expect(isStale(daysAgo(59.9), NOW)).toBe(false);
    expect(isStale(daysAgo(60.1), NOW)).toBe(true);
    expect(dataAge(daysAgo(59.9), NOW).stale).toBe(false);
    expect(dataAge(daysAgo(60.1), NOW).stale).toBe(true);
  });

  it("treats never-checked and unparseable as stale, not as fresh", () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale("not a date", NOW)).toBe(true);
  });

  it("agrees with the label on both sides of the line", () => {
    expect(label(daysAgo(59.9)).startsWith("checked")).toBe(true);
    expect(label(daysAgo(60.1)).startsWith("not checked")).toBe(true);
  });
});
