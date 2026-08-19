// Everything the public profile reads, in one place, so the template is only
// ever a template — the same split `shareData.ts` uses for the list page.
//
// No auth is consulted anywhere in this file. The token is the authorisation
// (decision 12) and it is scoped to exactly one person's profile.
//
// The privacy rule this file enforces, and it is stricter than the list
// page's: a profile names other people ONLY as cosigners, only when their own
// ranking is public, and never with a face. The author consented to
// publishing; nobody else did. And the *order* is not this page's to give
// away — the top five are named with their positions because PLAN's line item
// says "top five", and everything past five is named alphabetically with no
// position at all, which is a legend for the map rather than a ranking.

import type { DatabaseSync } from "node:sqlite";
import type { IntentTag, ShareToken } from "../../src/types/cosign.ts";
import { INTENT_TAG_LABELS_SHORT } from "../../src/types/cosign.ts";
import { paletteOf, type Palette } from "../../src/lib/palette.ts";
import { CAMPUS_CENTER, haversineMeters, walkingMinutes } from "../../src/lib/geo.ts";
import * as social from "../repo/social.ts";
import * as shopsRepo from "../repo/shops.ts";
import * as rank from "../repo/rank.ts";
import { buildMap, numberWord, ordinal, type MapModel, type MapPlace } from "./profileMap.ts";

export interface ProfileEntry {
  position: number;
  shopId: string;
  slug: string;
  name: string;
  palette: Palette;
  lat: number;
  lng: number;
  walkMin: number;
  /** Exact metres — the tiebreak, because three places round to 3 min. */
  metres: number;
  photo: string | null;
  /** Their own line about this place, if they left one. */
  line: string | null;
  /** When there is no line: what they came for, and when they last did. */
  visit: { tagLabel: string; bucket: string; month: string } | null;
  tagLabel: string | null;
  cosigners: rank.ShareCosigner[];
  cosignOthers: number;
  cosignState: "named" | "counted" | "none";
}

export interface ProfileData {
  token: string;
  author: {
    name: string;
    firstName: string;
    username: string;
    school: string;
    avatar: string | null;
    tasteLine: string | null;
    signatureOrder: string | null;
  };
  /** The five at the top, in order, with their own words. */
  top: ProfileEntry[];
  /** Everything past five, named alphabetically and never positioned. */
  rest: string[];
  entries: ProfileEntry[];
  map: MapModel;
  counts: {
    places: number;
    visits: number;
    reasons: number;
    /** The shortest walk on the sheet, and where they rank it. */
    nearestMin: number;
    nearestPosition: number;
    /** "the tenth of January" — the day they started writing things down. */
    since: string | null;
  };
  /** Three sentences about how the order got to be the order. */
  history: string[];
  /** The live ranking link, if they have one. Null closes the onward door. */
  rankingToken: string | null;
  updatedAt: string | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BUCKET_WORDS: Record<string, string> = {
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  late_night: "night",
};

/**
 * "the tenth of January". Read off the timestamp's own date part, never
 * through `new Date().getMonth()` — the Phase 4 lesson: a timestamp with an
 * offset renames the month for anyone in a different one.
 */
function dayInWords(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  void y;
  return `the ${ordinal(d)} of ${MONTHS[m - 1]}`;
}

/** Sorts "The All-Nighter" under A, the way a printed index would. */
const indexKey = (name: string) => name.replace(/^The\s+/i, "").toLowerCase();

export function loadProfileData(db: DatabaseSync, token: ShareToken): ProfileData | null {
  if (token.kind !== "profile") return null;
  const author = social.userById(db, token.user_id);
  if (!author) return null;
  const school =
    (db.prepare("SELECT name FROM schools WHERE id = ?").get(author.school_id) as { name: string } | undefined)
      ?.name ?? "";

  const lineOf = db.prepare(
    "SELECT line FROM logs WHERE user_id = ? AND shop_id = ? AND line IS NOT NULL ORDER BY created_at DESC LIMIT 1",
  );
  const visitOf = db.prepare(
    "SELECT intent_tag, time_bucket, created_at FROM logs WHERE user_id = ? AND shop_id = ? ORDER BY created_at DESC LIMIT 1",
  );

  const ranked = rank.rankingOf(db, token.user_id);
  const entries: ProfileEntry[] = [];
  for (const e of ranked) {
    const shop = shopsRepo.shopById(db, e.shop_id);
    if (!shop) continue;
    const cos = rank.cosignersForShare(db, e.shop_id, token.user_id);
    const visitRow = visitOf.get(token.user_id, e.shop_id) as
      | { intent_tag: IntentTag; time_bucket: string; created_at: string }
      | undefined;
    const metres = haversineMeters(CAMPUS_CENTER, shop);
    entries.push({
      position: e.position,
      shopId: shop.id,
      slug: shop.slug,
      name: shop.name,
      palette: paletteOf(shop.palette),
      lat: shop.lat,
      lng: shop.lng,
      walkMin: walkingMinutes(metres),
      metres,
      photo: shopsRepo.photosOf(db, e.shop_id)[0]?.path ?? null,
      line: (lineOf.get(token.user_id, e.shop_id) as { line: string } | undefined)?.line ?? null,
      visit: visitRow
        ? {
            tagLabel: INTENT_TAG_LABELS_SHORT[visitRow.intent_tag] ?? visitRow.intent_tag,
            bucket: BUCKET_WORDS[visitRow.time_bucket] ?? visitRow.time_bucket,
            month: MONTHS[Number(visitRow.created_at.slice(5, 7)) - 1] ?? "",
          }
        : null,
      tagLabel: visitRow ? (INTENT_TAG_LABELS_SHORT[visitRow.intent_tag] ?? visitRow.intent_tag) : null,
      cosigners: cos.named.slice(0, 3),
      cosignOthers: cos.others + Math.max(0, cos.named.length - 3),
      cosignState: cos.named.length ? "named" : cos.others ? "counted" : "none",
    });
  }

  const places: MapPlace[] = entries.map((e) => ({
    position: e.position,
    name: e.name,
    palette: e.palette,
    lat: e.lat,
    lng: e.lng,
    walkMin: e.walkMin,
  }));

  const visits = (db.prepare("SELECT count(*) n FROM logs WHERE user_id = ?").get(token.user_id) as { n: number }).n;
  const reasons = (
    db.prepare("SELECT count(DISTINCT intent_tag) n FROM logs WHERE user_id = ?").get(token.user_id) as { n: number }
  ).n;
  const firstLog = (
    db.prepare("SELECT min(created_at) t FROM logs WHERE user_id = ?").get(token.user_id) as { t: string | null }
  ).t;
  // Sorted on exact metres, never on the rounded minutes: Oval Grounds,
  // High Street Standard and Juniper are 232, 243 and 253 m from the Oval
  // and all three print as "3 min", so rounding first hands the tiebreak to
  // whichever happens to sit highest in the ranking — and the count then
  // names a different place than the map brackets.
  const nearest = [...entries].sort((a, b) => a.metres - b.metres)[0];

  return {
    token: token.token,
    author: {
      name: author.display_name,
      firstName: author.display_name.split(" ")[0],
      username: author.username,
      school,
      avatar: author.avatar,
      tasteLine: author.taste_line,
      signatureOrder: author.signature_order,
    },
    top: entries.slice(0, 5),
    rest: entries
      .slice(5)
      .map((e) => e.name)
      .sort((a, b) => indexKey(a).localeCompare(indexKey(b))),
    entries,
    map: buildMap(places, author.display_name.split(" ")[0]),
    counts: {
      places: entries.length,
      visits,
      reasons,
      nearestMin: nearest?.walkMin ?? 0,
      nearestPosition: nearest?.position ?? 0,
      since: firstLog ? dayInWords(firstLog) : null,
    },
    history: historySentences(db, token.user_id, entries, author.display_name.split(" ")[0]),
    rankingToken:
      (
        db
          .prepare(
            `SELECT token FROM share_tokens
             WHERE user_id = ? AND kind = 'ranking' AND revoked_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get(token.user_id) as { token: string } | undefined
      )?.token ?? null,
    updatedAt:
      (db.prepare("SELECT updated_at FROM rankings WHERE user_id = ?").get(token.user_id) as
        | { updated_at: string }
        | undefined)?.updated_at ?? null,
  };
}

/**
 * "The order has a history" — three sentences, and every one of them is a
 * claim the schema can actually support.
 *
 * `ranking_entries` carries `inserted_at` and `position`. It does NOT carry a
 * history of positions, and `insertIntoRanking` rewrites `inserted_at` when a
 * place is re-ranked, so "newest" means "most recently moved". Two of these
 * sentences are therefore about arrival versus *current* position, which is
 * derivable; the third is only ever said of the most recent arrival, because
 * nothing has been written since it landed. Anything that sounded like a
 * position history would be a sentence this database cannot back.
 */
function historySentences(db: DatabaseSync, userId: string, entries: ProfileEntry[], who: string): string[] {
  if (entries.length < 2) return [];
  const byShop = new Map(entries.map((e) => [e.shopId, e]));
  const arrival = (
    db
      .prepare("SELECT shop_id FROM ranking_entries WHERE user_id = ? ORDER BY inserted_at, position")
      .all(userId) as unknown as Array<{ shop_id: string }>
  )
    .map((r) => byShop.get(r.shop_id))
    .filter((e): e is ProfileEntry => !!e);
  if (arrival.length !== entries.length) return [];

  const n = entries.length;
  const out: string[] = [];

  const firstEver = arrival[0];
  const above = firstEver.position - 1;
  out.push(
    above === 0
      ? `${firstEver.name} was the first place ${who} ever put in order, and it is still first.`
      : `${firstEver.name} was the first place ${who} ever put in order. ${capitalise(numberWord(above))} ${above === 1 ? "place sits" : "places sit"} above it now.`,
  );

  // Only worth saying when the place at the bottom is not also the newest —
  // otherwise "arrived last and sits last" is a sentence about nothing.
  const last = entries[n - 1];
  const newest = arrival[n - 1];
  if (last.shopId !== newest.shopId) {
    const arrivedAt = arrival.findIndex((e) => e.shopId === last.shopId) + 1;
    const since = n - arrivedAt;
    if (since > 0) {
      out.push(
        `${last.name} came in ${ordinal(arrivedAt)} of ${numberWord(n)} and sits last. ` +
          `${capitalise(numberWord(since))} ${since === 1 ? "place has" : "places have"} arrived since, ` +
          `and ${since === 1 ? "it is" : `all ${numberWord(since)} are`} above it.`,
      );
    }
  }

  // Safe for the most recent arrival ALONE: nothing has been written since it
  // landed, so where it went in is still where it is. Never generalise this.
  out.push(`${newest.name} is the newest, and it walked straight in at ${ordinal(newest.position)}.`);

  return out;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
