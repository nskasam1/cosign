// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatWindow, isOpenAt, seedHoursToRows, toMinutes } from "./hours";

describe("shop hours", () => {
  it("parses HH:MM", () => {
    expect(toMinutes("07:30")).toBe(450);
    expect(toMinutes("24:00")).toBe(1440);
  });

  it("expands seed entries, pushing past-midnight closes over 1440", () => {
    const rows = seedHoursToRows([{ days: [1, 2], open: "10:00", close: "02:00" }]);
    expect(rows).toEqual([
      { day: 1, open_min: 600, close_min: 1560 },
      { day: 2, open_min: 600, close_min: 1560 },
    ]);
  });

  it("keeps 24h windows as 0..1440", () => {
    const rows = seedHoursToRows([{ days: [4], open: "00:00", close: "24:00" }]);
    expect(rows).toEqual([{ day: 4, open_min: 0, close_min: 1440 }]);
  });

  it("answers open-now within a same-day window", () => {
    const rows = seedHoursToRows([{ days: [1], open: "07:00", close: "21:00" }]);
    expect(isOpenAt(rows, 1, toMinutes("07:00"))).toBe(true);
    expect(isOpenAt(rows, 1, toMinutes("20:59"))).toBe(true);
    expect(isOpenAt(rows, 1, toMinutes("21:00"))).toBe(false);
    expect(isOpenAt(rows, 1, toMinutes("06:59"))).toBe(false);
    expect(isOpenAt(rows, 2, toMinutes("12:00"))).toBe(false);
  });

  it("handles past-midnight overflow into the next day", () => {
    // Night Owl: Monday 10:00 → 02:00 (Tuesday)
    const rows = seedHoursToRows([{ days: [1], open: "10:00", close: "02:00" }]);
    expect(isOpenAt(rows, 1, toMinutes("23:30"))).toBe(true); // Monday night
    expect(isOpenAt(rows, 2, toMinutes("01:30"))).toBe(true); // small hours Tuesday
    expect(isOpenAt(rows, 2, toMinutes("02:30"))).toBe(false);
    expect(isOpenAt(rows, 2, toMinutes("09:30"))).toBe(false);
  });

  it("treats days with no rows as closed", () => {
    const rows = seedHoursToRows([{ days: [1, 2, 3, 4, 5], open: "08:00", close: "18:00" }]);
    expect(isOpenAt(rows, 0, toMinutes("12:00"))).toBe(false); // Sunday closed
  });

  it("formats windows for humans", () => {
    expect(formatWindow(450, 1260)).toBe("7:30 AM – 9:00 PM");
    expect(formatWindow(600, 1560)).toBe("10:00 AM – 2:00 AM");
    expect(formatWindow(0, 1440)).toBe("Open 24 hours");
  });
});
