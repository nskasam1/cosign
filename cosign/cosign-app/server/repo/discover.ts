// What Home reads: the hero query, the friend-weighted order, and the
// freshness of every place in it (brief #7, #8, #10).
//
// The route in server/index.ts is a thin wrapper around `discover()` so that
// what ships and what the tests exercise are the same function — including
// the clock. `now` is an argument, which is how "mocked finals week changes
// Home" is testable without a date backdoor in the running server.

import type { DatabaseSync } from "node:sqlite";
import type { LatLng } from "../../src/lib/geo.ts";
import { CAMPUS_CENTER } from "../../src/lib/geo.ts";
import { phaseForDate, semesterForDate, type AcademicCalendar } from "../../src/lib/calendar.ts";
import { dataAge, isStale } from "../../src/lib/freshness.ts";
import { discoveryOrder, heroMatches, heroModeFor, heroPick, place } from "../../src/lib/discover.ts";
import type { SemesterPhase, Shop, ShopAmenities } from "../../src/types/cosign.ts";
import * as shops from "./shops.ts";
import { crowdScores, friendScores, friendSignals, type FriendOnList } from "./scores.ts";

export interface DiscoverEntry extends Shop {
  photo: string | null;
  open_now: boolean;
  stale: boolean;
  distance_m: number;
  walk_min: number;
  amenities: ShopAmenities | null;
  /** Lifted out of `amenities` because the hero query reads it directly. */
  outlet_count: number | null;
  closes_in_min: number | null;
  camp_ok: boolean;
  friend_count: number;
  friend_score: number;
  friend_sample: number;
  crowd_score: number;
  crowd_sample: number;
  you: number | null;
  friends: Array<Omit<FriendOnList, "user_id">>;
  others: number;
  cosign_total: number;
  age: ReturnType<typeof dataAge>;
}

export interface DiscoverView {
  /** Echoed so the caller can see what was used. Stored nowhere. */
  at: LatLng;
  phase: SemesterPhase;
  semester: string;
  hero: { mode: "usual" | "finals"; shop_id: string | null; matches: number };
  entries: DiscoverEntry[];
}

export function discover(
  db: DatabaseSync,
  calendar: AcademicCalendar,
  opts: { at?: LatLng; now?: Date; viewerId?: string | null } = {},
): DiscoverView {
  const at = opts.at ?? CAMPUS_CENTER;
  const now = opts.now ?? new Date();
  const viewerId = opts.viewerId ?? null;

  const phase = phaseForDate(calendar, now);
  const mode = heroModeFor(phase);
  const weighted = friendScores(db, viewerId);
  const crowd = crowdScores(db);
  const signals = friendSignals(db, viewerId);

  const candidates = shops.allShops(db).map((s) => {
    const score = weighted.get(s.id);
    const signal = signals.get(s.id);
    const amenities = shops.amenitiesOf(db, s.id);
    return {
      ...s,
      photo: shops.photosOf(db, s.id)[0]?.path ?? null,
      open_now: shops.isShopOpen(db, s.id, now, calendar.timezone),
      stale: isStale(s.last_verified_at, now),
      amenities,
      // hero-query inputs
      outlet_count: amenities?.outlet_count ?? null,
      closes_in_min: shops.shopClosesIn(db, s.id, now, calendar.timezone),
      camp_ok: Boolean(amenities?.camp_ok),
      // ordering. friend_count is the TIER — friends outrank the crowd at
      // any crowd size, which a weight on its own cannot promise.
      friend_count: (signal?.friends.length ?? 0) + (signal?.you == null ? 0 : 1),
      friend_score: score?.score ?? 0,
      friend_sample: score?.sample ?? 0,
      // The order this row would hold if nobody you knew counted for more
      // than anybody else. Home can show it; it is never what Home defaults
      // to, and the difference between the two is printed on the page.
      crowd_score: crowd.get(s.id)?.score ?? 0,
      crowd_sample: crowd.get(s.id)?.sample ?? 0,
      // why it sits where it sits. Only accepted friends are ever named:
      // stricter than the share page, which may name a stranger whose
      // ranking is public, because here "friends first" means friends only.
      you: signal?.you ?? null,
      friends: signal?.friends.map(({ user_id: _id, ...rest }) => rest) ?? [],
      others: signal?.others ?? 0,
      cosign_total: signal?.total ?? 0,
      // freshness (brief #10)
      age: dataAge(s.last_verified_at, now),
    };
  });

  const placed = place(candidates, at);
  const hero = heroPick(placed, mode);

  return {
    at,
    phase,
    semester: semesterForDate(calendar, now),
    hero: { mode, shop_id: hero?.id ?? null, matches: heroMatches(placed).length },
    entries: discoveryOrder(placed),
  };
}
