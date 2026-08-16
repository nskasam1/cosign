// Shop reads: list, detail, aggregations over logs (intent tallies, noise by
// time of day — labeled enums aggregated per bucket, never numeric scores),
// freshness, and the local place search that replaces Google Places.

import type { DatabaseSync } from "node:sqlite";
import type {
  IntentTag,
  NoiseLevel,
  CrowdLevel,
  Shop,
  ShopAmenities,
  ShopPhoto,
  TimeBucket,
} from "../../src/types/cosign.ts";
import { isOpenAt, localDayMinute, minutesUntilClose, type HoursRow } from "../lib/hours.ts";

export interface ShopRow extends Omit<Shop, "student_discount"> {
  student_discount: number;
}

export function allShops(db: DatabaseSync, schoolId?: string): Shop[] {
  const rows = (
    schoolId
      ? db.prepare("SELECT * FROM shops WHERE school_id = ? ORDER BY name").all(schoolId)
      : db.prepare("SELECT * FROM shops ORDER BY name").all()
  ) as unknown as ShopRow[];
  return rows.map(coerceShop);
}

export function shopById(db: DatabaseSync, id: string): Shop | null {
  const row = db.prepare("SELECT * FROM shops WHERE id = ?").get(id) as unknown as ShopRow | undefined;
  return row ? coerceShop(row) : null;
}

export function shopBySlug(db: DatabaseSync, slug: string): Shop | null {
  const row = db.prepare("SELECT * FROM shops WHERE slug = ?").get(slug) as unknown as ShopRow | undefined;
  return row ? coerceShop(row) : null;
}

function coerceShop(r: ShopRow): Shop {
  return { ...r, student_discount: !!r.student_discount };
}

export function amenitiesOf(db: DatabaseSync, shopId: string): ShopAmenities | null {
  const row = db.prepare("SELECT * FROM shop_amenities WHERE shop_id = ?").get(shopId) as
    | (Omit<ShopAmenities, "natural_light" | "camp_ok"> & { natural_light: number; camp_ok: number })
    | undefined;
  if (!row) return null;
  return { ...row, natural_light: !!row.natural_light, camp_ok: !!row.camp_ok };
}

export function photosOf(db: DatabaseSync, shopId: string): ShopPhoto[] {
  return db
    .prepare("SELECT * FROM shop_photos WHERE shop_id = ? ORDER BY sort")
    .all(shopId) as unknown as ShopPhoto[];
}

export function hoursOf(db: DatabaseSync, shopId: string): HoursRow[] {
  return db
    .prepare("SELECT day, open_min, close_min FROM shop_hours WHERE shop_id = ? ORDER BY day, open_min")
    .all(shopId) as unknown as HoursRow[];
}

export function isShopOpen(db: DatabaseSync, shopId: string, at: Date, timezone: string): boolean {
  const { day, minute } = localDayMinute(at, timezone);
  return isOpenAt(hoursOf(db, shopId), day, minute);
}

/** How much longer it stays open, or null when it is shut (Phase 4: finals
 *  week ranks on how long you can sit somewhere, not on whether it is open). */
export function shopClosesIn(db: DatabaseSync, shopId: string, at: Date, timezone: string): number | null {
  const { day, minute } = localDayMinute(at, timezone);
  return minutesUntilClose(hoursOf(db, shopId), day, minute);
}

/** Intent-tag tallies for a shop, derived from logs (one tap = one voice). */
export function intentTallies(db: DatabaseSync, shopId: string): Array<{ intent_tag: IntentTag; tally: number }> {
  return db
    .prepare(
      "SELECT intent_tag, count(*) AS tally FROM logs WHERE shop_id = ? GROUP BY intent_tag ORDER BY tally DESC",
    )
    .all(shopId) as unknown as Array<{ intent_tag: IntentTag; tally: number }>;
}

/**
 * Noise by time of day (decision 6): the modal noise/crowd label per
 * time_bucket from logs. Labels in, labels out — no numbers anywhere.
 */
export function conditionsByBucket(
  db: DatabaseSync,
  shopId: string,
): Partial<Record<TimeBucket, { noise: NoiseLevel | null; crowd: CrowdLevel | null; samples: number }>> {
  const rows = db
    .prepare(
      `SELECT time_bucket, noise, crowd, count(*) AS n FROM logs
       WHERE shop_id = ? GROUP BY time_bucket, noise, crowd`,
    )
    .all(shopId) as unknown as Array<{ time_bucket: TimeBucket; noise: NoiseLevel | null; crowd: CrowdLevel | null; n: number }>;
  const out: Partial<Record<TimeBucket, { noise: NoiseLevel | null; crowd: CrowdLevel | null; samples: number }>> = {};
  const buckets = new Map<TimeBucket, Array<{ noise: NoiseLevel | null; crowd: CrowdLevel | null; n: number }>>();
  for (const r of rows) {
    if (!buckets.has(r.time_bucket)) buckets.set(r.time_bucket, []);
    buckets.get(r.time_bucket)!.push(r);
  }
  for (const [bucket, group] of buckets) {
    const modal = <K extends "noise" | "crowd">(key: K) => {
      const counts = new Map<string, number>();
      for (const g of group) {
        if (g[key]) counts.set(g[key] as string, (counts.get(g[key] as string) ?? 0) + g.n);
      }
      let best: string | null = null;
      let bestN = 0;
      for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
      return best;
    };
    out[bucket] = {
      noise: modal("noise") as NoiseLevel | null,
      crowd: modal("crowd") as CrowdLevel | null,
      samples: group.reduce((s, g) => s + g.n, 0),
    };
  }
  return out;
}

export function confirmFreshness(db: DatabaseSync, shopId: string): void {
  db.prepare("UPDATE shops SET last_verified_at = ? WHERE id = ?").run(new Date().toISOString(), shopId);
}

/** Local autocomplete over seeded shops — the PlacesProvider stub. */
export function searchShops(db: DatabaseSync, q: string, limit = 8): Shop[] {
  const rows = db
    .prepare(
      `SELECT * FROM shops WHERE name LIKE ? OR address LIKE ? ORDER BY name LIMIT ?`,
    )
    .all(`%${q}%`, `%${q}%`, limit) as unknown as ShopRow[];
  return rows.map(coerceShop);
}
