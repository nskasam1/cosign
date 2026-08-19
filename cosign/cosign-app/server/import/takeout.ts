// Google Maps saved places → places Cosign already knows (brief #9: "Google
// Maps saved-places import at signup").
//
// Two files, because Takeout gives you two and they carry different things:
//   * `Saved Places.json` — GeoJSON, the master list: name, address, a
//     coordinate, the maps URL. No notes.
//   * a per-list CSV (`Title,Note,URL`) — the notes you actually wrote, for
//     one list, which may name a place the GeoJSON no longer has.
// Neither is a superset of the other, so they are joined by name and the
// union is what gets matched. Committed fixtures of both live in
// seed/takeout/ and IMPORT_FORMAT.md §3 documents them.
//
// PRIVACY. This module is pure: it takes text and shops and returns matches.
// It touches no database and stores nothing, and the route that calls it
// persists shop ids and the person's own note — never a coordinate, never an
// address, never the maps URL (decision 12: no persistent location history).
// The coordinates in a Takeout file are somebody's real movements; they are
// read to disambiguate a name and then dropped on the floor.

import { haversineMeters } from "../../src/lib/geo.ts";
import { splitCsvLine } from "./shopsCsv.ts";

/** One saved place, as it appears in the person's export. */
export interface SavedPlace {
  name: string;
  note: string | null;
  address: string | null;
  /** Present only if the GeoJSON carried this place. Never persisted. */
  lat: number | null;
  lng: number | null;
  /** Which file(s) it came from — the transcript reads better for it. */
  sources: Array<"geojson" | "csv">;
}

/** The minimum a shop has to expose to be matchable. */
export interface MatchableShop {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lng: number;
}

export type MatchKind =
  /** The names are the same once punctuation and articles are set aside. */
  | "certain"
  /** A shorter or longer form of one of our names, close enough to ask about. */
  | "likely"
  /** We do not have this place. */
  | "unknown";

export interface TakeoutMatch {
  place: SavedPlace;
  kind: MatchKind;
  shop: MatchableShop | null;
  /** Metres between the saved coordinate and ours; null if the file had none. */
  distance_m: number | null;
  /** Why, in the words the screen uses. */
  because: string;
}

export interface TakeoutReport {
  places: SavedPlace[];
  matches: TakeoutMatch[];
  counts: { total: number; certain: number; likely: number; unknown: number };
}

// ── names ───────────────────────────────────────────────────────────────────

/**
 * "The All-Nighter" and "the all nighter" and "The All Nighter" are one
 * place; "Petal & Bean" and "Petal and Bean" are one place. Everything else
 * is somebody else's.
 *
 * Note what is NOT stripped: "Coffee", "Cafe", "Roasters". Dropping a
 * category word is how "Juniper Bar & Kitchen" becomes "Juniper Coffee Club"
 * — see the `likely` tier, which handles the short-form case explicitly and
 * makes the person confirm it rather than guessing on their behalf.
 */
export function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (normalised: string): string[] => (normalised === "" ? [] : normalised.split(" "));

// ── parsing ─────────────────────────────────────────────────────────────────

/** Takeout writes UTF-8 with a BOM and CRLF line endings. Both are ours to absorb. */
const clean = (text: string): string => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

const trimmedOrNull = (s: string | undefined | null): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

/**
 * `Saved Places.json` — a GeoJSON FeatureCollection whose interesting parts
 * are `geometry.coordinates` (lng first, as GeoJSON requires) and
 * `properties.location.{name,address}`.
 */
export function parseSavedPlacesGeoJson(text: string): SavedPlace[] {
  let doc: unknown;
  try {
    doc = JSON.parse(clean(text));
  } catch {
    throw new Error("That doesn't look like the Saved Places file — it isn't valid JSON.");
  }
  const features = (doc as { type?: string; features?: unknown[] })?.features;
  if (!Array.isArray(features)) {
    throw new Error("That JSON file has no `features` — Takeout's Saved Places.json does.");
  }
  const out: SavedPlace[] = [];
  for (const raw of features) {
    const f = raw as {
      geometry?: { coordinates?: unknown };
      properties?: { location?: { name?: string; address?: string } };
    };
    const name = trimmedOrNull(f?.properties?.location?.name);
    if (!name) continue; // a feature with no name is not a place anyone saved
    const coords = f?.geometry?.coordinates;
    // GeoJSON is [lng, lat]. Getting this backwards puts a Columbus café in
    // the Indian Ocean, which a distance check would then quietly reject.
    const lng = Array.isArray(coords) ? Number(coords[0]) : NaN;
    const lat = Array.isArray(coords) ? Number(coords[1]) : NaN;
    const usable = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    out.push({
      name,
      note: null,
      address: trimmedOrNull(f?.properties?.location?.address),
      lat: usable ? lat : null,
      lng: usable ? lng : null,
      sources: ["geojson"],
    });
  }
  return out;
}

/**
 * A saved-list CSV: `Title,Note,URL`, RFC-4180 quoting, and the notes are
 * the only place the person's own words survive the export.
 */
export function parseSavedPlacesCsv(text: string): SavedPlace[] {
  const lines = clean(text).split("\n");
  const header = lines[0]?.trim().toLowerCase();
  if (!header?.startsWith("title,note")) {
    throw new Error("That CSV's first line isn't `Title,Note,URL` — Takeout's saved-list export is.");
  }
  const out: SavedPlace[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const [title, note] = splitCsvLine(line);
    const name = trimmedOrNull(title);
    if (!name) continue;
    out.push({ name, note: trimmedOrNull(note), address: null, lat: null, lng: null, sources: ["csv"] });
  }
  return out;
}

/** Sniff which of the two a file is, so nobody has to be told which box to use. */
export function parseSavedPlacesFile(text: string): SavedPlace[] {
  return clean(text).trimStart().startsWith("{") ? parseSavedPlacesGeoJson(text) : parseSavedPlacesCsv(text);
}

/**
 * The union of every file handed over, joined on the normalised name.
 *
 * A place in both files keeps the GeoJSON's coordinate and the CSV's note,
 * which is the whole reason for accepting both. First occurrence wins for
 * the display name, so the spelling the person sees is the one from the
 * first file they gave us.
 */
export function mergeSavedPlaces(batches: SavedPlace[][]): SavedPlace[] {
  const byName = new Map<string, SavedPlace>();
  for (const batch of batches) {
    for (const place of batch) {
      const key = normaliseName(place.name);
      const seen = byName.get(key);
      if (!seen) {
        byName.set(key, { ...place, sources: [...place.sources] });
        continue;
      }
      seen.note ??= place.note;
      seen.address ??= place.address;
      if (seen.lat === null && place.lat !== null) {
        seen.lat = place.lat;
        seen.lng = place.lng;
      }
      for (const s of place.sources) if (!seen.sources.includes(s)) seen.sources.push(s);
    }
  }
  return [...byName.values()];
}

// ── matching ────────────────────────────────────────────────────────────────

/**
 * How far apart two records of the same place may be and still be the same
 * place. A phone's saved pin and our address for a shop disagree by a few
 * tens of metres routinely; 150 m is a block.
 */
export const LIKELY_MAX_METERS = 150;

/**
 * How far apart an exactly-named match may be before we stop believing the
 * name. Two different businesses genuinely share a name across a city, and
 * a person who saved the other branch should not have ours written into
 * their list. Generous, because a name match is strong evidence.
 */
export const CERTAIN_MAX_METERS = 1500;

/** At most this many extra words in our name than in theirs, for `likely`. */
const LIKELY_MAX_EXTRA_TOKENS = 2;

function metresBetween(place: SavedPlace, shop: MatchableShop): number | null {
  if (place.lat === null || place.lng === null) return null;
  return Math.round(haversineMeters({ lat: place.lat, lng: place.lng }, { lat: shop.lat, lng: shop.lng }));
}

/**
 * Match one saved place against the places Cosign knows.
 *
 * THE RULE THIS ENCODES: a coordinate is never, on its own, a reason to say
 * two records are the same place. The name is the identity; the coordinate
 * can corroborate it or veto it, and nothing else. The committed fixtures
 * carry two traps that exist to hold this rule down —
 *   * "Batch & Crumb Bakery" sits 48 m from Bramble,
 *   * "Juniper Bar & Kitchen" sits 24 m from Juniper Coffee Club and shares
 *     a word with it,
 * and a nearest-point matcher writes both into somebody's list as places
 * they have never been. There is no undo in this flow that would catch it.
 */
export function matchSavedPlace(place: SavedPlace, shops: MatchableShop[]): TakeoutMatch {
  const theirs = normaliseName(place.name);
  const theirTokens = tokens(theirs);

  const exact = shops
    .map((shop) => ({ shop, distance_m: metresBetween(place, shop) }))
    .filter(({ shop }) => normaliseName(shop.name) === theirs)
    .filter(({ distance_m }) => distance_m === null || distance_m <= CERTAIN_MAX_METERS)
    .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0))[0];

  if (exact) {
    return {
      place,
      kind: "certain",
      shop: exact.shop,
      distance_m: exact.distance_m,
      because: exact.distance_m === null ? "same name" : `same name, ${exact.distance_m} m apart`,
    };
  }

  // A shorter or longer form of one of our names — "Hackberry" for Hackberry
  // Roasters. Every word of the shorter name must appear in the longer, and
  // the longer may add at most two: that is what keeps "Juniper Bar &
  // Kitchen" away from "Juniper Coffee Club", which shares one word and
  // differs by three.
  const candidates = shops
    .map((shop) => ({ shop, distance_m: metresBetween(place, shop), ours: tokens(normaliseName(shop.name)) }))
    .filter(({ ours }) => {
      if (theirTokens.length === 0 || ours.length === 0) return false;
      const [shorter, longer] = theirTokens.length <= ours.length ? [theirTokens, ours] : [ours, theirTokens];
      if (longer.length - shorter.length > LIKELY_MAX_EXTRA_TOKENS) return false;
      return shorter.every((t) => longer.includes(t));
    })
    .filter(({ distance_m }) => distance_m === null || distance_m <= LIKELY_MAX_METERS)
    .sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));

  // Two candidates and no coordinate to separate them is not a guess worth
  // making on somebody's behalf.
  const ambiguous = candidates.length > 1 && candidates[0].distance_m === null;
  if (candidates.length && !ambiguous) {
    const best = candidates[0];
    return {
      place,
      kind: "likely",
      shop: best.shop,
      distance_m: best.distance_m,
      because:
        best.distance_m === null
          ? `you saved it as “${place.name}”`
          : `you saved it as “${place.name}”, ${best.distance_m} m from ours`,
    };
  }

  return { place, kind: "unknown", shop: null, distance_m: null, because: "not a place Cosign knows yet" };
}

/**
 * The whole import, from file text to something a screen can render.
 *
 * One shop is claimed once: if two saved places both resolve to Wheelhouse,
 * the certain one keeps it and the other falls back to `unknown`, because a
 * list cannot hold the same place twice and silently dropping the second
 * would make the counts lie.
 */
export function importSavedPlaces(files: string[], shops: MatchableShop[]): TakeoutReport {
  const places = mergeSavedPlaces(files.map(parseSavedPlacesFile));
  const matches = places.map((p) => matchSavedPlace(p, shops));

  const claimed = new Set<string>();
  for (const kind of ["certain", "likely"] as const) {
    for (const m of matches) {
      if (m.kind !== kind || !m.shop) continue;
      if (claimed.has(m.shop.id)) {
        m.kind = "unknown";
        m.shop = null;
        m.distance_m = null;
        m.because = "already matched by another place you saved";
      } else {
        claimed.add(m.shop.id);
      }
    }
  }

  return {
    places,
    matches,
    counts: {
      total: matches.length,
      certain: matches.filter((m) => m.kind === "certain").length,
      likely: matches.filter((m) => m.kind === "likely").length,
      unknown: matches.filter((m) => m.kind === "unknown").length,
    },
  };
}
