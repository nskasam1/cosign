// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../db/db";
import { northStarWeekly, track } from "./analytics";

const dir = mkdtempSync(join(tmpdir(), "cosign-test-"));
const db = createDb(join(dir, "test.db"));

// minimal fixtures (schema requires users to exist only via FK on user_id
// being nullable in analytics_events — but we insert real users anyway)
db.exec(`INSERT INTO schools (id, name) VALUES ('osu', 'Ohio State University');`);
for (const u of ["u_quiet", "u_logger", "u_oneday", "u_ghost"]) {
  db.prepare(
    "INSERT INTO users (id, username, display_name, school_id, created_at) VALUES (?,?,?,?,?)",
  ).run(u, u.slice(2), u, "osu", "2026-01-01T00:00:00Z");
}

const WEEK = new Date("2026-08-03T00:00:00Z");
const at = (day: number, hour: number) =>
  new Date(WEEK.getTime() + day * 86400_000 + hour * 3600_000);

// u_quiet: opens twice on distinct days, logs nothing → NORTH STAR
track(db, "u_quiet", "app_open", {}, at(1, 12));
track(db, "u_quiet", "app_open", {}, at(3, 19));
// u_logger: opens twice on distinct days but logged → excluded
track(db, "u_logger", "app_open", {}, at(1, 9));
track(db, "u_logger", "app_open", {}, at(2, 9));
track(db, "u_logger", "log_created", { shop_id: "s_x" }, at(2, 9));
// u_oneday: two opens but the same day → excluded
track(db, "u_oneday", "app_open", {}, at(4, 8));
track(db, "u_oneday", "app_open", {}, at(4, 20));
// u_ghost: opens on distinct days but outside the week → excluded
track(db, "u_ghost", "app_open", {}, at(-2, 12));
track(db, "u_ghost", "app_open", {}, at(9, 12));
// anonymous events never count
track(db, null, "app_open", {}, at(1, 1));
track(db, null, "app_open", {}, at(2, 1));

describe("north-star query: weekly returning users who logged nothing", () => {
  it("counts exactly the quiet returner", () => {
    const res = northStarWeekly(db, WEEK);
    expect(res.users).toEqual(["u_quiet"]);
    expect(res.count).toBe(1);
  });

  it("window boundaries are [start, start+7d)", () => {
    const res = northStarWeekly(db, new Date("2026-08-10T00:00:00Z"));
    expect(res.users).toEqual([]);
  });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
