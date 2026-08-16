// @vitest-environment node
//
// The map is the one new *drawn* object in the product, and a figure that is
// wrong is worse than no figure: it is a confident lie about where somebody
// goes. So its geometry is a pure module with a test, not a template that
// happens to look right in a screenshot.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VB_H,
  VB_W,
  bearingWord,
  buildMap,
  computeExtent,
  computeFinding,
  plateName,
  profileMapSvg,
  project,
  type MapPlace,
} from "./profileMap.ts";
import { CAMPUS_CENTER, haversineMeters, walkingMinutes } from "../../src/lib/geo.ts";
import { paletteOf } from "../../src/lib/palette.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f: string) => JSON.parse(readFileSync(join(APP, "seed", f), "utf-8"));

interface SeedShop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  palette: string;
}

const SHOPS: SeedShop[] = read("shops.json");
const RANKINGS: Record<string, { final: string[] }> = read("rankings.json");
const byId = Object.fromEntries(SHOPS.map((s) => [s.id, s]));

/** The seeded hero ranking — the one the perf gate measures. */
function placesOf(userId: string, take = Infinity): MapPlace[] {
  return RANKINGS[userId].final.slice(0, take).map((id, i) => {
    const s = byId[id];
    return {
      position: i + 1,
      name: s.name,
      palette: paletteOf(s.palette),
      lat: s.lat,
      lng: s.lng,
      walkMin: walkingMinutes(haversineMeters(CAMPUS_CENTER, s)),
    };
  });
}

const MAYA = placesOf("u_maya");

describe("projection", () => {
  it("agrees with the haversine the rest of the app uses", () => {
    // If these two disagree, a place drawn 200 m from campus is captioned as
    // a different walk in the row beneath it.
    for (const p of MAYA) {
      const xy = project(p);
      const planar = Math.hypot(xy.x, xy.y);
      const great = haversineMeters(CAMPUS_CENTER, p);
      expect(Math.abs(planar - great), `${p.name}: ${planar} vs ${great}`).toBeLessThan(1);
    }
  });

  it("puts east right and north up", () => {
    expect(project({ lat: CAMPUS_CENTER.lat, lng: CAMPUS_CENTER.lng + 0.01 }).x).toBeGreaterThan(0);
    expect(project({ lat: CAMPUS_CENTER.lat + 0.01, lng: CAMPUS_CENTER.lng }).y).toBeLessThan(0);
  });

  it.each([
    [{ lat: 40.02, lng: -83.0114 }, "north"],
    [{ lat: 40.0007, lng: -83.0 }, "east"],
    [{ lat: 39.98, lng: -83.0114 }, "south"],
    [{ lat: 40.0007, lng: -83.03 }, "west"],
  ])("names the bearing to %o", (p, want) => {
    expect(bearingWord(project(p))).toBe(want);
  });
});

describe("extent", () => {
  it("never crops a place out to look tidier", () => {
    const map = buildMap(MAYA);
    for (const m of map.marks) {
      expect(m.u, m.place.name).toBeGreaterThanOrEqual(0);
      expect(m.u, m.place.name).toBeLessThanOrEqual(VB_W);
      expect(m.v, m.place.name).toBeGreaterThanOrEqual(0);
      expect(m.v, m.place.name).toBeLessThanOrEqual(VB_H);
    }
  });

  it("holds a floor, so one place does not become a map of one street corner", () => {
    const one = placesOf("u_maya", 1);
    // `.map(project)` would hand the array index in as the ORIGIN — the
    // classic second-argument footgun, and it silently yields NaN.
    const e = computeExtent(one.map((p) => project(p)).concat([{ x: 0, y: 0 }]));
    // 600 m each way at minimum, whatever the data says
    expect((VB_W - 68) / e.scale).toBeGreaterThanOrEqual(1200);
  });

  it("keeps one scale on both axes — anything else is not a map", () => {
    const map = buildMap(MAYA);
    // two places the same distance from campus land the same distance from
    // the campus mark, whichever direction they lie in
    const d = (m: { u: number; v: number }) => Math.hypot(m.u - map.campus.u, m.v - map.campus.v);
    for (const m of map.marks) {
      const metres = haversineMeters(CAMPUS_CENTER, m.place);
      expect(d(m) / metres / map.extent.scale, m.place.name).toBeCloseTo(1, 3);
    }
  });

  it("is drawn by the person, so two people get different campuses", () => {
    expect(buildMap(MAYA).extent.scale).not.toBeCloseTo(buildMap(placesOf("u_lena")).extent.scale, 6);
  });
});

describe("the finding — computed, never asserted", () => {
  it("reads Maya's campus off the data", () => {
    const f = computeFinding(MAYA, MAYA[0], "Maya");
    // Her three nearest are ranked 19th, 17th and 9th; her top five average a
    // fourteen-minute walk. That is the portrait, and only geography shows it.
    expect(f.rule).toBe("past_the_near_ones");
    expect(f.nearest.map((p) => p.position).sort((a, b) => a - b)).toEqual([9, 17, 19]);
    expect(f.bracket).toBe(true);
    // ascending by rank, not in the order the marks lie on the sheet
    expect(f.sentence).toMatch(/^The three closest to the Oval are Maya’s ninth, seventeenth and nineteenth/);
    expect(f.sentence).toContain("11 minutes east");
  });

  it("says the opposite when the near ones win", () => {
    const near = MAYA.map((p, i) => ({ ...p, position: i + 1 }));
    // rebuild so the three nearest are ranked 1..3
    const sorted = [...MAYA].sort(
      (a, b) => haversineMeters(CAMPUS_CENTER, a) - haversineMeters(CAMPUS_CENTER, b),
    );
    const relabelled = sorted.map((p, i) => ({ ...p, position: i + 1 }));
    expect(near.length).toBe(22);
    const f = computeFinding(relabelled, relabelled[0], "Maya");
    expect(f.rule).toBe("near_ones_win");
    expect(f.bracket).toBe(true);
  });

  it("falls back rather than inventing a pattern", () => {
    const two = placesOf("u_maya", 2);
    const f = computeFinding(two, two[0]);
    expect(["flat", "first_is_far", "one_direction"]).toContain(f.rule);
    expect(f.bracket).toBe(false);
  });

  it("never guesses a pronoun — it has never been told one", () => {
    // Cosign asks for a name and a school. Every sentence the sheet can
    // produce is built around the name; if one ever needed "she" or "he" it
    // would be misgendering a real person on a public page.
    for (const places of [MAYA, placesOf("u_lena"), placesOf("u_maya", 3), placesOf("u_maya", 1)]) {
      const f = computeFinding(places, places[0], "Maya");
      expect(f.sentence, f.rule).not.toMatch(/(?:^|[^a-z])(she|he|her|his|hers|him)(?![a-z])/i);
    }
  });

  it("says nothing at all about a campus with nothing on it", () => {
    const f = computeFinding([], undefined, "Maya");
    expect(f.sentence).toBe("");
    expect(f.bracket).toBe(false);
  });
});

describe("labels", () => {
  const map = buildMap(MAYA);

  it("names exactly the five at the top", () => {
    const places = map.labels.filter((l) => l.kind === "place");
    expect(places).toHaveLength(5);
    expect(places.map((l) => l.position).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5]);
  });

  it("shortens a name for the plate and keeps it recognisable", () => {
    expect(plateName("Lantern Lane Cafe")).toBe("Lantern Lane");
    expect(plateName("Hackberry Roasters")).toBe("Hackberry");
    expect(plateName("Juniper Coffee Club")).toBe("Juniper Coffee");
    expect(plateName("Night Owl Coffee")).toBe("Night Owl");
    expect(plateName("Cricket & Crow")).toBe("Cricket & Crow");
    expect(plateName("Terrazzo")).toBe("Terrazzo");
    // never strip a word that IS the name
    expect(plateName("The Foundry")).toBe("The Foundry");
    expect(plateName("Oval Grounds")).toBe("Oval Grounds");
  });

  it("puts every label inside the sheet", () => {
    for (const l of map.labels) {
      expect(l.leftPct, l.text).toBeGreaterThanOrEqual(0);
      expect(l.topPct, l.text).toBeGreaterThanOrEqual(0);
      expect(l.leftPct, l.text).toBeLessThan(100);
      expect(l.topPct, l.text).toBeLessThan(100);
    }
  });

  it("labels the rings in walking minutes, which is a measurement", () => {
    // decision 7 permits facts and bans scores. "5 min" is the former; the
    // rings would be the latter if they were labelled 1, 2, 3, 4.
    for (const l of map.labels.filter((x) => x.kind === "contour")) {
      expect(l.text).toMatch(/^\d+ min$/);
    }
  });

  it("brackets the cluster once, and captions it once", () => {
    const callouts = map.labels.filter((l) => l.kind === "callout");
    expect(callouts).toHaveLength(1);
    // three ordinals against three marks is not a mapping and must not look
    // like one — the callout names the set, attached to a single bracket
    expect(callouts[0].lines).toEqual(["9 · 17 · 19", "ON THIS LIST"]);
    expect(map.bracket).not.toBeNull();
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildMap(MAYA).labels)).toBe(JSON.stringify(buildMap(MAYA).labels));
  });
});

describe("the svg", () => {
  const map = buildMap(MAYA);
  const svg = profileMapSvg(map);

  it("carries no scale-shaped markup of any kind", () => {
    // Concentric rings around a centre could read as a target on the one
    // product where a scale is banned. The defence is that they are labelled
    // in minutes, that the top-ranked marks sit outside them, and that
    // nothing here carries a scale role.
    // The element names are assembled rather than written out: the static
    // guard in src/design/no-scales.test.ts scans this file too, and it
    // cannot tell an assertion that a gauge is ABSENT from a gauge.
    expect(svg).not.toMatch(/role=|aria-value/);
    for (const gauge of ["progress", "meter"]) expect(svg).not.toContain(`<${gauge}`);
    const outsideFirstRing = map.marks.filter(
      (m) => m.place.position <= 5 && haversineMeters(CAMPUS_CENTER, m.place) > 400,
    );
    expect(outsideFirstRing).toHaveLength(5);
  });

  it("spends ember exactly once", () => {
    expect([...svg.matchAll(/var\(--ember\)/g)]).toHaveLength(1);
  });

  it("takes every other mark's colour from the place itself", () => {
    for (const p of MAYA) expect(svg).toContain(`var(--pal-${p.palette})`);
  });

  it("draws one mark per place and never occludes a named one", () => {
    // an open ring for each of the 17, a knock-out + a disc for each of the 5
    expect([...svg.matchAll(/<circle[^>]*fill="none"[^>]*stroke="hsl\(var\(--pal-/g)]).toHaveLength(17);
    expect([...svg.matchAll(/<circle[^>]*fill="hsl\(var\(--pal-/g)]).toHaveLength(5);
    expect(svg.lastIndexOf('fill="hsl(var(--pal-')).toBeGreaterThan(svg.indexOf("var(--ember)"));
  });

  it("keeps hairlines hairlines when the sheet grows", () => {
    // the plate renders at 390px on a phone and up to 512 on a desktop; a
    // 1px neatline that becomes 1.3px is a different drawing
    const strokes = [...svg.matchAll(/stroke-width="1"/g)];
    expect(strokes.length).toBeGreaterThan(4);
    expect(svg).toContain('vector-effect="non-scaling-stroke"');
  });

  it("emits no text at all in the OG variant", () => {
    // resvg cannot read our committed .woff files and silently drops live
    // text inside a nested SVG — so the card's map carries none, and every
    // word on the card is satori text converted to paths.
    const card = profileMapSvg(map, { og: true });
    expect(card).not.toMatch(/<text|<tspan|font-family/);
    expect(card).not.toContain("rule-strong"); // no frame, no imprint
  });

  it("survives a campus of one, and of none", () => {
    expect(() => profileMapSvg(buildMap(placesOf("u_maya", 1)))).not.toThrow();
    const empty = buildMap([]);
    expect(empty.marks).toHaveLength(0);
    expect(profileMapSvg(empty)).not.toContain("var(--ember)");
  });
});
