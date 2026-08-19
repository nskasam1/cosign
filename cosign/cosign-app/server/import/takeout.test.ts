// @vitest-environment node
//
// The Phase 5A acceptance criterion is "Takeout fixtures import in onboarding
// + empty states (test)", so this runs against the COMMITTED fixtures and the
// COMMITTED shops — not against strings written to make a matcher look good.
// The synthetic cases below exist only for hazards a fixture cannot carry at
// the same time as being a realistic export (a BOM, a swapped coordinate, two
// saved places fighting over one shop).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CERTAIN_MAX_METERS,
  LIKELY_MAX_METERS,
  importSavedPlaces,
  matchSavedPlace,
  mergeSavedPlaces,
  normaliseName,
  parseSavedPlacesCsv,
  parseSavedPlacesGeoJson,
  type MatchableShop,
  type SavedPlace,
} from "./takeout.ts";
import { haversineMeters } from "../../src/lib/geo.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = (f: string) => readFileSync(join(APP, "seed", "takeout", f), "utf-8");
const GEOJSON = fixture("saved-places.geojson");
const CSV = fixture("saved-places.csv");

const SHOPS: MatchableShop[] = (
  JSON.parse(readFileSync(join(APP, "seed", "shops.json"), "utf-8")) as MatchableShop[]
).map((s) => ({ id: s.id, slug: s.slug, name: s.name, lat: s.lat, lng: s.lng }));

const place = (over: Partial<SavedPlace> = {}): SavedPlace => ({
  name: "Somewhere",
  note: null,
  address: null,
  lat: null,
  lng: null,
  sources: ["csv"],
  ...over,
});

describe("normaliseName", () => {
  it.each([
    ["The All-Nighter", "all nighter"],
    ["the all nighter", "all nighter"],
    ["Petal & Bean", "petal and bean"],
    ["Petal and Bean", "petal and bean"],
    ["Cricket & Crow", "cricket and crow"],
    ["the foundry", "foundry"],
    ["The Foundry", "foundry"],
  ])("%s -> %s", (raw, want) => {
    expect(normaliseName(raw)).toBe(want);
  });

  it("keeps the category word, because dropping it is how a bar becomes a café", () => {
    // "Juniper Bar & Kitchen" and "Juniper Coffee Club" are two businesses
    // 24 m apart in the fixture. Strip "bar"/"kitchen"/"coffee"/"club" as
    // noise and they are the same place.
    expect(normaliseName("Juniper Bar & Kitchen")).not.toBe(normaliseName("Juniper Coffee Club"));
  });
});

describe("parsing the committed Saved Places GeoJSON", () => {
  const places = parseSavedPlacesGeoJson(GEOJSON);

  it("reads every feature", () => {
    expect(places).toHaveLength(14);
  });

  it("reads the coordinate as [lng, lat], which is the way round GeoJSON writes it", () => {
    const wheelhouse = places.find((p) => p.name === "Wheelhouse Coffee")!;
    expect(wheelhouse.lat).toBeCloseTo(40.0053, 4);
    expect(wheelhouse.lng).toBeCloseTo(-83.0091, 4);
    // Every place is on campus, not in the Indian Ocean — the shape of the
    // failure if these were ever swapped.
    for (const p of places) {
      expect(p.lat, p.name).toBeGreaterThan(39);
      expect(p.lng, p.name).toBeLessThan(-82);
    }
  });

  it("carries the address and no note (the GeoJSON has none to carry)", () => {
    const p = places.find((x) => x.name === "Marginalia")!;
    expect(p.address).toBe("56 E Frambes Ave, Columbus, OH 43201, USA");
    expect(p.note).toBeNull();
  });

  it("refuses a file that is not a FeatureCollection", () => {
    expect(() => parseSavedPlacesGeoJson("{}")).toThrow(/features/);
    expect(() => parseSavedPlacesGeoJson("not json")).toThrow(/valid JSON/);
  });
});

describe("parsing the committed saved-list CSV", () => {
  const rows = parseSavedPlacesCsv(CSV);

  it("reads every row", () => {
    expect(rows).toHaveLength(13);
  });

  it("keeps a comma that lives inside a quoted note", () => {
    expect(rows.find((r) => r.name === "Marginalia")!.note).toBe("quiet, bring a book");
    expect(rows.find((r) => r.name === "the foundry")!.note).toBe("the back room, if it's free");
  });

  it("unescapes a doubled quote", () => {
    expect(rows.find((r) => r.name === "Night Owl Coffee")!.note).toBe(
      'open late!! ("til 1" is a lie on sundays)',
    );
  });

  it("treats an empty note as no note", () => {
    expect(rows.find((r) => r.name === "Cricket & Crow")!.note).toBeNull();
  });

  it("survives a BOM and CRLF, which is how Takeout actually writes it", () => {
    const windows = "\uFEFF" + CSV.replace(/\n/g, "\r\n");
    expect(parseSavedPlacesCsv(windows)).toEqual(rows);
  });

  it("refuses a CSV that is not this export", () => {
    expect(() => parseSavedPlacesCsv("name,lat,lng\nx,1,2")).toThrow(/Title,Note,URL/);
  });
});

describe("joining the two files", () => {
  const merged = mergeSavedPlaces([parseSavedPlacesGeoJson(GEOJSON), parseSavedPlacesCsv(CSV)]);

  it("is the union, not either file", () => {
    // 14 in the GeoJSON, 13 in the CSV, 12 in both.
    expect(merged).toHaveLength(15);
  });

  it("takes the coordinate from one file and the note from the other", () => {
    const w = merged.find((p) => p.name === "Wheelhouse Coffee")!;
    expect(w.lat).toBeCloseTo(40.0053, 4);
    expect(w.note).toBe("best outlets on campus");
    expect(w.sources).toEqual(["geojson", "csv"]);
  });

  it("keeps a place the CSV names and the GeoJSON has forgotten", () => {
    const c = merged.find((p) => p.name === "Cardinal & Vine")!;
    expect(c.sources).toEqual(["csv"]);
    expect(c.lat).toBeNull();
    expect(c.note).toBe("the patio in september");
  });

  it("does not care which spelling of a name arrived first", () => {
    const a = mergeSavedPlaces([[place({ name: "Petal & Bean", note: "x" })], [place({ name: "petal and bean" })]]);
    expect(a).toHaveLength(1);
    expect(a[0].name).toBe("Petal & Bean");
  });
});

describe("the committed fixtures, mapped onto the committed places", () => {
  const report = importSavedPlaces([GEOJSON, CSV], SHOPS);
  const by = (name: string) => report.matches.find((m) => m.place.name === name)!;

  it("recognises ten of the fifteen outright and offers one more", () => {
    expect(report.counts).toEqual({ total: 15, certain: 10, likely: 1, unknown: 4 });
  });

  it.each([
    ["Wheelhouse Coffee", "s_wheelhouse"],
    ["Cricket & Crow", "s_cricket-and-crow"],
    ["Terrazzo", "s_terrazzo"],
    ["Night Owl Coffee", "s_night-owl"],
    ["Oval Grounds", "s_oval-grounds"],
    ["Marginalia", "s_marginalia"],
    ["The All-Nighter", "s_all-nighter"],
    ["Petal and Bean", "s_petal-and-bean"],
    ["the foundry", "s_foundry"],
    ["Cardinal & Vine", "s_cardinal-and-vine"],
  ])("%s is certainly %s", (saved, shopId) => {
    const m = by(saved);
    expect(m.kind).toBe("certain");
    expect(m.shop?.id).toBe(shopId);
  });

  it("matches a name with nothing to corroborate it, and says so", () => {
    // Cardinal & Vine exists only in the CSV, so there is no coordinate at
    // all. The name is the identity; the coordinate was only ever evidence.
    const m = by("Cardinal & Vine");
    expect(m.distance_m).toBeNull();
    expect(m.because).toBe("same name");
  });

  it("asks about a short form instead of assuming it", () => {
    const m = by("Hackberry");
    expect(m.kind).toBe("likely");
    expect(m.shop?.id).toBe("s_hackberry");
    expect(m.distance_m).toBeLessThanOrEqual(LIKELY_MAX_METERS);
    expect(m.because).toMatch(/you saved it as “Hackberry”/);
  });

  it.each([
    ["Batch & Crumb Bakery", "s_bramble"],
    ["Juniper Bar & Kitchen", "s_juniper"],
  ])("does not match %s, which is metres from %s", (saved, nearId) => {
    const m = by(saved);
    const near = SHOPS.find((s) => s.id === nearId)!;
    const p = m.place;
    // The trap is real: the nearest place we know is well inside any radius
    // a proximity matcher would use.
    const metres = haversineMeters({ lat: p.lat!, lng: p.lng! }, { lat: near.lat, lng: near.lng });
    expect(metres).toBeLessThan(50);
    // And it is still not matched, because a coordinate is never on its own
    // a reason to say two records are the same place.
    expect(m.kind).toBe("unknown");
    expect(m.shop).toBeNull();
  });

  it.each([["The Copper Finch Cafe"], ["Iuka Ridge Branch Library"]])(
    "leaves %s unmatched and named, rather than dropping it",
    (saved) => {
      const m = by(saved);
      expect(m.kind).toBe("unknown");
      expect(m.place.name).toBe(saved);
    },
  );

  it("never invents a place: every match points at a shop that exists", () => {
    for (const m of report.matches) {
      if (!m.shop) continue;
      expect(SHOPS.some((s) => s.id === m.shop!.id), m.place.name).toBe(true);
    }
  });

  it("claims each shop once", () => {
    const ids = report.matches.filter((m) => m.shop).map((m) => m.shop!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the person's own words through to the match", () => {
    expect(by("Wheelhouse Coffee").place.note).toBe("best outlets on campus");
    expect(by("Marginalia").place.note).toBe("quiet, bring a book");
  });
});

describe("the rules the matcher will not bend", () => {
  it("stops believing a name once the coordinate is a different city", () => {
    const portland = place({ name: "Terrazzo", lat: 45.5152, lng: -122.6784 });
    expect(matchSavedPlace(portland, SHOPS).kind).toBe("unknown");
    // and the threshold is a campus, not a continent
    expect(CERTAIN_MAX_METERS).toBeLessThan(5000);
  });

  it("will not choose between two equally plausible short forms with no coordinate", () => {
    const shops: MatchableShop[] = [
      { id: "s_a", slug: "a", name: "Juniper Coffee Club", lat: 40, lng: -83 },
      { id: "s_b", slug: "b", name: "Juniper Coffee House", lat: 40.001, lng: -83.001 },
    ];
    expect(matchSavedPlace(place({ name: "Juniper Coffee" }), shops).kind).toBe("unknown");
  });

  it("separates them again as soon as there is a coordinate", () => {
    const shops: MatchableShop[] = [
      { id: "s_a", slug: "a", name: "Juniper Coffee Club", lat: 40, lng: -83 },
      { id: "s_b", slug: "b", name: "Juniper Coffee House", lat: 40.01, lng: -83.01 },
    ];
    const m = matchSavedPlace(place({ name: "Juniper Coffee", lat: 40.0001, lng: -83.0001 }), shops);
    expect(m.kind).toBe("likely");
    expect(m.shop?.id).toBe("s_a");
  });

  it("hands a contested shop to the certain match and tells the other one why", () => {
    const shops: MatchableShop[] = [{ id: "s_h", slug: "h", name: "Hackberry Roasters", lat: 40, lng: -83 }];
    const report = importSavedPlaces(
      [
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            { geometry: { coordinates: [-83, 40] }, properties: { location: { name: "Hackberry Roasters" } } },
            { geometry: { coordinates: [-83.0002, 40.0002] }, properties: { location: { name: "Hackberry" } } },
          ],
        }),
      ],
      shops,
    );
    expect(report.counts).toEqual({ total: 2, certain: 1, likely: 0, unknown: 1 });
    const loser = report.matches.find((m) => m.place.name === "Hackberry")!;
    expect(loser.because).toBe("already matched by another place you saved");
  });

  it("reads a file it was not told the type of", () => {
    expect(importSavedPlaces([CSV, GEOJSON], SHOPS).counts.total).toBe(15);
  });
});
