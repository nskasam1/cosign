// @vitest-environment node
import { describe, expect, it } from "vitest";
import { localDateString, phaseForDate, semesterForDate, type AcademicCalendar } from "./calendar";

const cal: AcademicCalendar = {
  school: "osu",
  timezone: "America/New_York",
  terms: [
    {
      slug: "2026-autumn",
      name: "Autumn 2026",
      start: "2026-08-25",
      end: "2026-12-17",
      week_one_end: "2026-08-31",
      finals_start: "2026-12-09",
    },
  ],
};

describe("academic calendar", () => {
  it("maps in-term dates to the term slug", () => {
    expect(semesterForDate(cal, new Date("2026-10-01T12:00:00-04:00"))).toBe("2026-autumn");
  });

  it("maps between-term dates to break", () => {
    expect(semesterForDate(cal, new Date("2026-08-15T12:00:00-04:00"))).toBe("break");
    expect(phaseForDate(cal, new Date("2026-08-15T12:00:00-04:00"))).toBe("break");
  });

  it("detects week one, mid-semester, and finals", () => {
    expect(phaseForDate(cal, new Date("2026-08-26T09:00:00-04:00"))).toBe("week_one");
    expect(phaseForDate(cal, new Date("2026-10-15T09:00:00-04:00"))).toBe("mid_semester");
    expect(phaseForDate(cal, new Date("2026-12-10T09:00:00-05:00"))).toBe("finals");
  });

  it("uses the school's local date, not UTC (the old semester.ts bug)", () => {
    // 2026-08-25T03:00Z is still Aug 24 in New York — before the term starts.
    const lateNightUtc = new Date("2026-08-25T03:00:00Z");
    expect(localDateString(lateNightUtc, "America/New_York")).toBe("2026-08-24");
    expect(semesterForDate(cal, lateNightUtc)).toBe("break");
    // ...but by 13:00Z it's Aug 25 locally: term has begun.
    expect(semesterForDate(cal, new Date("2026-08-25T13:00:00Z"))).toBe("2026-autumn");
  });

  it("term boundaries are inclusive on both ends", () => {
    expect(semesterForDate(cal, new Date("2026-08-25T10:00:00-04:00"))).toBe("2026-autumn");
    expect(semesterForDate(cal, new Date("2026-12-17T10:00:00-05:00"))).toBe("2026-autumn");
    expect(semesterForDate(cal, new Date("2026-12-18T10:00:00-05:00"))).toBe("break");
  });
});
