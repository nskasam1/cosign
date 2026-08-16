// Logs: the ≤10s input mechanic (decision 4). time_bucket and semester are
// stamped server-side at creation — the client never supplies them.

import type { DatabaseSync } from "node:sqlite";
import type { CrowdLevel, IntentTag, Log, LogTaps, NoiseLevel, Visibility } from "../../src/types/cosign.ts";
import { semesterForDate, type AcademicCalendar } from "../../src/lib/calendar.ts";
import { currentTimeBucket } from "../../src/lib/timeBucket.ts";

interface LogRow extends Omit<Log, "taps"> {
  taps_json: string;
}

function coerce(r: LogRow): Log {
  const { taps_json, ...rest } = r;
  return { ...rest, taps: JSON.parse(taps_json || "{}") as LogTaps };
}

/** The only tap keys that may be persisted, all strictly boolean. Without
 *  this whitelist an arbitrary client body could smuggle a numeric scale
 *  into a log and defeat the no-rating-scales rule at the storage layer. */
const TAP_KEYS = ["found_outlet", "wifi_held_up", "got_a_table", "would_camp"] as const;

function cleanTaps(taps: LogTaps | undefined): LogTaps {
  const out: Record<string, boolean> = {};
  for (const k of TAP_KEYS) if (taps?.[k] !== undefined) out[k] = Boolean(taps[k]);
  return out as LogTaps;
}

export function createLog(
  db: DatabaseSync,
  calendar: AcademicCalendar,
  input: {
    user_id: string;
    shop_id: string;
    intent_tag: IntentTag;
    noise?: NoiseLevel | null;
    crowd?: CrowdLevel | null;
    taps?: LogTaps;
    photo?: string | null;
    line?: string | null;
    visibility?: Visibility;
  },
  now = new Date(),
): Log {
  const id = `lg_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(
    `INSERT INTO logs (id, user_id, shop_id, intent_tag, time_bucket, semester, noise, crowd, taps_json, photo, line, visibility, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.user_id,
    input.shop_id,
    input.intent_tag,
    currentTimeBucket(now),
    semesterForDate(calendar, now),
    input.noise ?? null,
    input.crowd ?? null,
    JSON.stringify(cleanTaps(input.taps)),
    input.photo ?? null,
    input.line ?? null,
    input.visibility ?? "friends",
    now.toISOString(),
  );
  return coerce(db.prepare("SELECT * FROM logs WHERE id = ?").get(id) as unknown as LogRow);
}

/** A user's logs as `viewerId` may see them (owner/friend sees all, others
 *  see only the public ones). Pass the viewer explicitly so no caller can
 *  accidentally read a friends-only log into a public surface. */
export function logsOfUser(
  db: DatabaseSync,
  userId: string,
  viewerId: string | null,
  canSeeFriendsOnly: boolean,
  limit = 50,
): Log[] {
  const all = canSeeFriendsOnly || viewerId === userId;
  const rows = db
    .prepare(
      `SELECT * FROM logs WHERE user_id = ?${all ? "" : " AND visibility = 'public'"}
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, limit) as unknown as LogRow[];
  return rows.map(coerce);
}

/**
 * When this user was last in this shop, from their own logs alone.
 *
 * Deliberately its own query rather than a scan of `visibleLogsForShop`,
 * which is capped at 30 rows: thirty newer logs from other people would push
 * the viewer's own out of that window, and the freshness prompt would stop
 * asking the one person who can answer it precisely when a place got busy.
 */
export function lastVisitOf(db: DatabaseSync, shopId: string, userId: string): string | null {
  const row = db
    .prepare("SELECT max(created_at) AS at FROM logs WHERE shop_id = ? AND user_id = ?")
    .get(shopId, userId) as { at: string | null } | undefined;
  return row?.at ?? null;
}

/**
 * Logs for a shop visible to the viewer: public + own + friends'.
 * The predicate lives in SQL, not in a post-filter — filtering after a
 * fixed prefetch would drop a friend's older log once a shop got busy.
 */
export function visibleLogsForShop(
  db: DatabaseSync,
  shopId: string,
  viewerId: string | null,
  friendIds: string[],
  limit = 30,
): Log[] {
  const own = viewerId ? [viewerId, ...friendIds] : [];
  const placeholders = own.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM logs
        WHERE shop_id = ?
          AND (visibility = 'public'${own.length ? ` OR user_id IN (${placeholders})` : ""})
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(shopId, ...own, limit) as unknown as LogRow[];
  return rows.map(coerce);
}
