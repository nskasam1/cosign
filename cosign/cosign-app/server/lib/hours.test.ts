// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatWindow, isOpenAt, minutesUntilClose, seedHoursToRows, toMinutes } from "./hours";

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

// Phase 4: finals week ranks on how long you can sit somewhere, and open-now
// cannot answer that — a place shutting in nine minutes is open and useless.
describe("how much longer it stays open", () => {
  it("counts to the close of a same-day window", () => {
    const rows = seedHoursToRows([{ days: [1], open: "07:00", close: "21:00" }]);
    expect(minutesUntilClose(rows, 1, toMinutes("07:00"))).toBe(840);
    expect(minutesUntilClose(rows, 1, toMinutes("20:30"))).toBe(30);
  });

  it("is null when the place is shut, never zero", () => {
    const rows = seedHoursToRows([{ days: [1], open: "07:00", close: "21:00" }]);
    expect(minutesUntilClose(rows, 1, toMinutes("21:00"))).toBeNull();
    expect(minutesUntilClose(rows, 1, toMinutes("06:00"))).toBeNull();
    expect(minutesUntilClose(rows, 2, toMinutes("12:00"))).toBeNull();
  });

  it("counts past midnight rather than stopping at it", () => {
    // Night Owl: Monday 10:00 → 02:00. At 23:30 you have 150 minutes, not 30.
    const rows = seedHoursToRows([{ days: [1], open: "10:00", close: "02:00" }]);
    expect(minutesUntilClose(rows, 1, toMinutes("23:30"))).toBe(150);
    expect(minutesUntilClose(rows, 2, toMinutes("01:30"))).toBe(30); // the small hours
    expect(minutesUntilClose(rows, 2, toMinutes("02:00"))).toBeNull();
  });

  it("joins windows that OVERLAP, not only ones that meet at midnight", () => {
    // The real All-Nighter: 07:00–01:00 Monday to Wednesday, round the clock
    // Thursday to Sunday. At 2pm on a Wednesday, Wednesday's window runs to
    // 01:00 Thursday and Thursday's has been open since midnight — it is one
    // run to Monday 00:00, 106 hours away, not the eleven hours Wednesday's
    // row says on its own.
    const rows = seedHoursToRows([
      { days: [1, 2, 3], open: "07:00", close: "01:00" },
      { days: [4, 5, 6, 0], open: "00:00", close: "24:00" },
    ]);
    expect(minutesUntilClose(rows, 3, toMinutes("14:00"))).toBe(106 * 60);
    // ...but Monday afternoon is only Monday's window: Tuesday opens at 07:00,
    // which is after Monday's 01:00 close, so the run really does end there.
    expect(minutesUntilClose(rows, 1, toMinutes("14:00"))).toBe(11 * 60);
  });

  it("joins days that meet exactly at midnight into one run", () => {
    // The All-Nighter is 00:00–24:00 on Thursday through Sunday and opens at
    // 07:00 on Monday. Standing in it at 10am on Thursday, it does not shut
    // in fourteen hours — it shuts on Monday morning, 86 hours later.
    const rows = seedHoursToRows([
      { days: [4, 5, 6, 0], open: "00:00", close: "24:00" },
      { days: [1, 2, 3], open: "07:00", close: "01:00" },
    ]);
    expect(minutesUntilClose(rows, 4, toMinutes("10:00"))).toBe(86 * 60);
    // ...and from Sunday evening it is only the rest of Sunday.
    expect(minutesUntilClose(rows, 0, toMinutes("22:00"))).toBe(120);
  });

  it("terminates on a shop that never closes at all", () => {
    const always = seedHoursToRows([{ days: [0, 1, 2, 3, 4, 5, 6], open: "00:00", close: "24:00" }]);
    const left = minutesUntilClose(always, 3, toMinutes("12:00"));
    expect(left).toBeGreaterThan(7 * 1440);
    expect(Number.isFinite(left!)).toBe(true);
  });

  it("takes the longest window when a day has two", () => {
    const rows = seedHoursToRows([{ days: [1], open: "07:00", close: "11:30" }, { days: [1], open: "15:00", close: "21:00" }]);
    expect(minutesUntilClose(rows, 1, toMinutes("08:00"))).toBe(210);
    expect(minutesUntilClose(rows, 1, toMinutes("12:00"))).toBeNull(); // the gap
    expect(minutesUntilClose(rows, 1, toMinutes("16:00"))).toBe(300);
  });
});
