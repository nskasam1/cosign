// Local analytics events (decision 11). Data never leaves this machine.
// North star: weekly returning users who logged nothing — users with
// app_open events on ≥2 distinct days within the week AND zero log_created
// events that week.

import type { DatabaseSync } from "node:sqlite";

export function track(
  db: DatabaseSync,
  userId: string | null,
  event: string,
  props: Record<string, unknown> = {},
  now = new Date(),
): void {
  db.prepare(
    "INSERT INTO analytics_events (user_id, event, props_json, created_at) VALUES (?,?,?,?)",
  ).run(userId, event, JSON.stringify(props), now.toISOString());
}

export interface NorthStarResult {
  week_start: string;
  week_end: string;
  users: string[];
  count: number;
}

/**
 * North-star cohort for the 7-day window starting at weekStart (inclusive).
 * Timestamps are compared in UTC (all server writes store UTC ISO strings;
 * seed timestamps carry offsets, which SQLite's datetime() normalizes).
 */
export function northStarWeekly(db: DatabaseSync, weekStart: Date): NorthStarResult {
  const start = weekStart.toISOString();
  const end = new Date(weekStart.getTime() + 7 * 86400_000).toISOString();
  const rows = db
    .prepare(
      `WITH win AS (
         SELECT user_id, event, date(datetime(created_at)) AS d
         FROM analytics_events
         WHERE user_id IS NOT NULL
           AND datetime(created_at) >= datetime(?)
           AND datetime(created_at) <  datetime(?)
       )
       SELECT o.user_id
       FROM (SELECT user_id, count(DISTINCT d) AS days FROM win WHERE event = 'app_open' GROUP BY user_id) o
       WHERE o.days >= 2
         AND o.user_id NOT IN (SELECT DISTINCT user_id FROM win WHERE event = 'log_created')
       ORDER BY o.user_id`,
    )
    .all(start, end) as unknown as Array<{ user_id: string }>;
  return {
    week_start: start,
    week_end: end,
    users: rows.map((r) => r.user_id),
    count: rows.length,
  };
}
