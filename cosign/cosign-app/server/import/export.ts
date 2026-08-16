// DB → seed-shaped JSON: the other half of the round-trip guarantee
// (IMPORT_FORMAT.md §5). exportSeed(db) returns objects matching the seed
// files exactly, so runSeed on an export reproduces the same database.

import type { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

type Row = Record<string, unknown>;

function all(db: DatabaseSync, sql: string, ...args: Array<string | number>): Row[] {
  return db.prepare(sql).all(...args) as unknown as Row[];
}

function minutesToHHMM(m: number): string {
  if (m === 1440) return "24:00";
  const mm = m % 1440;
  const h = Math.floor(mm / 60);
  return `${String(h).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}

function rowsToSeedHours(rows: Array<{ day: number; open_min: number; close_min: number }>) {
  // canonical grouping: identical (open,close) windows merge their days
  const groups = new Map<string, { days: number[]; open: string; close: string }>();
  for (const r of rows) {
    const open = minutesToHHMM(r.open_min);
    const close = r.close_min > 1440 ? minutesToHHMM(r.close_min - 1440) : minutesToHHMM(r.close_min);
    const key = `${open}|${close}`;
    if (!groups.has(key)) groups.set(key, { days: [], open, close });
    groups.get(key)!.days.push(r.day);
  }
  return [...groups.values()].map((g) => ({ ...g, days: g.days.sort((a, b) => a - b) }));
}

export interface SeedExport {
  shops: unknown[];
  users: unknown[];
  friendships: unknown[];
  logs: unknown[];
  rankings: Record<string, { final: string[]; arrival: string[] }>;
  lists: unknown[];
  shareTokens: unknown[];
}

export function exportSeed(db: DatabaseSync): SeedExport {
  const shops = all(db, "SELECT * FROM shops ORDER BY id").map((s) => {
    const hours = all(
      db,
      "SELECT day, open_min, close_min FROM shop_hours WHERE shop_id = ? ORDER BY day, open_min",
      s.id as string,
    ) as Array<{ day: number; open_min: number; close_min: number }>;
    const a = all(db, "SELECT * FROM shop_amenities WHERE shop_id = ?", s.id as string)[0] ?? {};
    const photos = all(
      db,
      "SELECT kind FROM shop_photos WHERE shop_id = ? ORDER BY sort",
      s.id as string,
    ).map((p) => p.kind);
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      school: s.school_id,
      price_drip: s.price_drip,
      price_latte: s.price_latte,
      student_discount: !!s.student_discount,
      ...(s.student_discount_note ? { student_discount_note: s.student_discount_note } : {}),
      last_verified_at: s.last_verified_at,
      hours: rowsToSeedHours(hours),
      amenities: {
        outlet_count: a.outlet_count ?? null,
        outlet_note: a.outlet_note ?? null,
        seat_count: a.seat_count ?? null,
        table_size: a.table_size ?? null,
        wifi_mbps: a.wifi_mbps ?? null,
        wifi_note: a.wifi_note ?? null,
        bathroom_access: a.bathroom_access ?? null,
        bathroom_code: a.bathroom_code ?? null,
        natural_light: !!a.natural_light,
        camp_ok: !!a.camp_ok,
        camp_note: a.camp_note ?? null,
      },
      one_liner: s.one_liner,
      palette: s.palette,
      photos,
    };
  });

  const users = all(db, "SELECT * FROM users ORDER BY created_at, id").map((u) => ({
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    school: u.school_id,
    taste_line: u.taste_line,
    signature_order: u.signature_order,
    avatar: u.avatar,
    created_at: u.created_at,
  }));

  const friendships = all(db, "SELECT * FROM friendships ORDER BY rowid").map((f) => ({
    user_id: f.user_id,
    friend_id: f.friend_id,
    status: f.status,
    created_at: f.created_at,
    responded_at: f.responded_at,
  }));

  const logs = all(db, "SELECT * FROM logs ORDER BY id").map((l) => ({
    id: l.id,
    user_id: l.user_id,
    shop_id: l.shop_id,
    intent_tag: l.intent_tag,
    time_bucket: l.time_bucket,
    created_at: l.created_at,
    noise: l.noise,
    crowd: l.crowd,
    taps: JSON.parse((l.taps_json as string) || "{}"),
    photo: l.photo,
    line: l.line,
    visibility: l.visibility,
  }));

  const rankings: Record<
    string,
    { final: string[]; arrival: string[]; title?: string | null; visibility?: string }
  > = {};
  const rankUsers = all(db, "SELECT DISTINCT user_id FROM ranking_entries ORDER BY user_id");
  for (const { user_id } of rankUsers as Array<{ user_id: string }>) {
    const final = all(
      db,
      "SELECT shop_id FROM ranking_entries WHERE user_id = ? ORDER BY position",
      user_id,
    ).map((r) => r.shop_id as string);
    const arrival = all(
      db,
      "SELECT shop_id FROM ranking_entries WHERE user_id = ? ORDER BY inserted_at, shop_id",
      user_id,
    ).map((r) => r.shop_id as string);
    // carry the ranking's own row so visibility survives a round trip
    const meta = all(db, "SELECT title, visibility FROM rankings WHERE user_id = ?", user_id)[0] as
      | { title: string | null; visibility: string }
      | undefined;
    rankings[user_id] = {
      final,
      arrival,
      title: meta?.title ?? null,
      visibility: meta?.visibility ?? "friends",
    };
  }

  const lists = all(db, "SELECT * FROM lists ORDER BY rowid").map((l) => ({
    id: l.id,
    owner_id: l.owner_id,
    title: l.title,
    visibility: l.visibility,
    is_collaborative: !!l.is_collaborative,
    editors: all(db, "SELECT user_id FROM list_editors WHERE list_id = ? ORDER BY rowid", l.id as string).map(
      (e) => e.user_id,
    ),
    items: all(db, "SELECT * FROM list_items WHERE list_id = ? ORDER BY position", l.id as string).map((it) => ({
      shop_id: it.shop_id,
      added_by: it.added_by,
      ...(it.note ? { note: it.note } : {}),
    })),
    created_at: l.created_at,
  }));

  const shareTokens = all(db, "SELECT * FROM share_tokens ORDER BY rowid").map((t) => ({
    token: t.token,
    kind: t.kind,
    user_id: t.user_id,
    ...(t.list_id ? { list_id: t.list_id } : {}),
    created_at: t.created_at,
    revoked_at: t.revoked_at,
  }));

  return { shops, users, friendships, logs, rankings, lists, shareTokens };
}

/** Write an export as a complete, re-seedable seed directory. */
export function writeSeedDir(exported: SeedExport, dir: string, calendarPath: string): void {
  mkdirSync(dir, { recursive: true });
  const write = (name: string, data: unknown) =>
    writeFileSync(join(dir, name), JSON.stringify(data, null, 1), "utf-8");
  write("shops.json", exported.shops);
  write("users.json", exported.users);
  write("friendships.json", exported.friendships);
  write("logs.json", exported.logs);
  write("rankings.json", exported.rankings);
  write("lists.json", exported.lists);
  write("share-tokens.json", exported.shareTokens);
  copyFileSync(calendarPath, join(dir, "academic-calendar.json"));
}
