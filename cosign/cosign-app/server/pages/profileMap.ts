// The drawn campus on the public profile — "map of places as local SVG"
// (PLAN.md, Phase 5A). Pure geometry and strings: no database, no DOM, no
// tiles, no basemap, no network. Unit-tested on its own.
//
// Why a map earns its place on a page that already has a ranked list one
// link away: the list says what this person likes and the map says where
// they will actually walk, and for a real person those two disagree. Maya's
// three nearest places are her 19th, 17th and 9th; her top five average a
// fourteen-minute walk. No column of names can show that. A figure that
// cannot say something the list cannot is decoration, so this one computes
// what it has found (`computeFinding`) and the caption prints it.
//
// STREETS ARE NOT DRAWN. The seed has addresses but no street geometry, and
// inferring High Street from a line of coordinates would be inventing data on
// a page whose whole argument is that it does not.

import { CAMPUS_CENTER, type LatLng } from "../../src/lib/geo.ts";
import type { Palette } from "../../src/lib/palette.ts";
import { resolveTokenColours } from "./tokenHex.ts";

export interface MapPlace {
  position: number;
  name: string;
  palette: Palette;
  lat: number;
  lng: number;
  /** Minutes on foot from campus — the unit every ring is labelled in. */
  walkMin: number;
}

/** The sheet's user-space. Everything below is in these units. */
export const VB_W = 390;
export const VB_H = 430;
const PAD = 34;
const FIELD_W = VB_W - PAD * 2; // 322
const FIELD_H = VB_H - PAD * 2; // 362
const ASPECT = FIELD_W / FIELD_H;

/** Half-width of the smallest frame we will draw, in metres. */
const EXTENT_FLOOR_M = 600;
/** Rings every five walking minutes: 80 m/min (src/lib/geo.ts). */
const CONTOUR_M = [400, 800, 1200, 1600];

const NAMED = 5;

// ── projection ──────────────────────────────────────────────────────────────
// Equirectangular about the campus point, compressing x by the cosine of the
// *mean* latitude of the two points rather than of the origin. That is the
// first-order match to the haversine `src/lib/geo.ts` uses everywhere else —
// same sphere, same radius — and over a 2.5 km field the two agree to well
// under a metre. Compressing by the origin's latitude alone is the version
// you find in a blog post; it drifts ~3 m at a kilometre, which is not
// visible on the sheet but does mean the picture and the walking time beside
// it are computed from two different Earths.
//
// Unlike Web Mercator it needs no tiles to mean anything, which is the whole
// reason this page can draw a map with zero external services.
const DEG_M = (Math.PI / 180) * 6371000;

export function project(p: LatLng, origin: LatLng = CAMPUS_CENTER): { x: number; y: number } {
  const midLat = (((origin.lat + p.lat) / 2) * Math.PI) / 180;
  return {
    x: (p.lng - origin.lng) * DEG_M * Math.cos(midLat), // east positive
    y: (origin.lat - p.lat) * DEG_M, // south positive
  };
}

export interface Extent {
  xMin: number;
  yMin: number;
  /** User units per metre — identical on both axes, or it is not a map. */
  scale: number;
}

/**
 * The frame is drawn by where this person goes, so a different person gets a
 * differently-shaped campus.
 *
 * Step four only ever GROWS the box. A map that leaves a place out to look
 * tidier is lying, and the one thing this figure is for is being true.
 */
export function computeExtent(points: Array<{ x: number; y: number }>): Extent {
  let xMin = -EXTENT_FLOOR_M;
  let xMax = EXTENT_FLOOR_M;
  let yMin = -EXTENT_FLOOR_M;
  let yMax = EXTENT_FLOOR_M;
  for (const p of points) {
    xMin = Math.min(xMin, p.x);
    xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  }
  // 10% breathing room, half on each side
  let w = (xMax - xMin) * 1.1;
  let h = (yMax - yMin) * 1.1;
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  if (w / h < ASPECT) w = h * ASPECT;
  else h = w / ASPECT;
  return { xMin: cx - w / 2, yMin: cy - h / 2, scale: FIELD_W / w };
}

const toU = (x: number, e: Extent) => PAD + (x - e.xMin) * e.scale;
const toV = (y: number, e: Extent) => PAD + (y - e.yMin) * e.scale;

// ── the finding ─────────────────────────────────────────────────────────────

export type FindingRule = "past_the_near_ones" | "first_is_far" | "one_direction" | "near_ones_win" | "flat";

export interface Finding {
  rule: FindingRule;
  /** Ranks of the three places closest to campus, ascending by distance. */
  nearest: MapPlace[];
  /** True when the caption is about a cluster and the sheet brackets it. */
  bracket: boolean;
  sentence: string;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const OPPOSITE = ["southern", "south-western", "western", "north-western", "northern", "north-eastern", "eastern", "south-eastern"];

/** Which of the eight compass words points from campus to this place. */
export function bearingWord(place: { x: number; y: number }): string {
  return COMPASS[bearingIndex(place)];
}

function bearingIndex(p: { x: number; y: number }): number {
  // atan2 with screen-y (south positive) flipped back to compass degrees
  const deg = (Math.atan2(p.x, -p.y) * 180) / Math.PI;
  return (Math.round(((deg + 360) % 360) / 45) % 8 + 8) % 8;
}

const ORDINALS = [
  "", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth",
  "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third",
  "twenty-fourth", "twenty-fifth",
];
export const ordinal = (n: number): string => ORDINALS[n] ?? `${n}th`;

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty", "twenty-one", "twenty-two", "twenty-three", "twenty-four", "twenty-five"];
export const numberWord = (n: number): string => WORDS[n] ?? String(n);

/**
 * What this sheet actually shows, decided from the data and never asserted.
 * The first rule that qualifies wins; the last always does.
 *
 * `who` is the author's first name, and every sentence here is built around
 * it rather than around a pronoun. Cosign asks for a name and a school and
 * nothing else — it has never been told anybody's pronouns, and a public page
 * about a real person is the last place to guess. Using the name also reads
 * better: this is a caption on a figure, not a paragraph about a stranger.
 */
export function computeFinding(places: MapPlace[], first: MapPlace | undefined, who = "They"): Finding {
  const withXy = places.map((p) => ({ p, xy: project(p), d: Math.hypot(project(p).x, project(p).y) }));
  const nearest = [...withXy].sort((a, b) => a.d - b.d).slice(0, 3).map((r) => r.p);
  const n = places.length;
  const topThird = Math.ceil(n / 3);
  const firstXy = first ? project(first) : { x: 0, y: 0 };
  const firstBearing = first ? bearingWord(firstXy) : "";
  const walks = withXy.map((r) => r.p.walkMin).sort((a, b) => a - b);
  const median = walks[Math.floor(walks.length / 2)] ?? 0;

  if (n >= 9 && Math.min(...nearest.map((p) => p.position)) > topThird) {
    // Ascending by RANK, deliberately not in the order the three marks
    // happen to lie on the sheet. Three ordinals beside three places invites
    // the reader to pair them up one for one, and that pairing would be
    // invented — the sentence is about the set, not about which is which.
    const [a, b, c] = [...nearest]
      .sort((x, y) => x.position - y.position)
      .map((p) => ordinal(p.position));
    return {
      rule: "past_the_near_ones",
      nearest,
      bracket: true,
      sentence: `The three closest to the Oval are ${who}’s ${a}, ${b} and ${c} — the line to the first runs straight past all three, ${first!.walkMin} minutes ${firstBearing}.`,
    };
  }

  if (first && median > 0 && first.walkMin >= 1.6 * median) {
    const passed = places.filter((p) => p.position !== 1 && p.walkMin < first.walkMin).length;
    return {
      rule: "first_is_far",
      nearest,
      bracket: false,
      sentence: `The first place on this sheet is also the longest walk on it — ${first.walkMin} minutes ${firstBearing}, past ${numberWord(passed)} places already in order.`,
    };
  }

  const quadrant = new Map<number, number>();
  for (const r of withXy) {
    const q = Math.floor(bearingIndex(r.xy) / 2);
    quadrant.set(q, (quadrant.get(q) ?? 0) + 1);
  }
  const [domQ, domN] = [...quadrant.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
  if (n >= 4 && domN / n >= 0.7) {
    return {
      rule: "one_direction",
      nearest,
      bracket: false,
      sentence: `Nearly everything ${who} has put in order is ${COMPASS[domQ * 2 + 1]} of the Oval. The ${OPPOSITE[domQ * 2 + 1]} half of this sheet is empty, and that is a fact about ${who} too.`,
    };
  }

  if (n >= 9 && Math.max(...nearest.map((p) => p.position)) <= topThird) {
    return {
      rule: "near_ones_win",
      nearest,
      bracket: true,
      sentence: `The three closest to the Oval are also three of ${who}’s first ${numberWord(topThird)}. Short walks, and no sign of regret about it.`,
    };
  }

  const farthest = Math.max(...places.map((p) => p.walkMin), 0);
  return {
    rule: "flat",
    nearest,
    bracket: false,
    sentence: first
      ? `${who}’s first is ${first.walkMin} minutes ${firstBearing} of the Oval; the farthest thing on the sheet is ${farthest}.`
      : "",
  };
}

// ── labels ──────────────────────────────────────────────────────────────────

export interface MapLabel {
  kind: "place" | "contour" | "campus" | "north" | "imprint" | "callout";
  /** Percentages of the viewBox, so the layer scales with the sheet. */
  leftPct: number;
  topPct: number;
  /** For a place label: the numeral, its palette, and the shortened name. */
  position?: number;
  palette?: Palette;
  text: string;
  lines?: string[];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box, gap = 0): boolean =>
  a.x - gap < b.x + b.w && a.x + a.w + gap > b.x && a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;

/**
 * "Lantern Lane Cafe" -> "Lantern Lane". One trailing category word, and only
 * when a name is left behind: "The Foundry" and "Oval Grounds" keep every
 * word, because there the category word IS the name. Full names appear in the
 * five rows beneath the sheet, which is where somebody reads rather than
 * glances.
 */
const CATEGORY = /^(Cafe|Café|Coffee|Roasters|Roasting|Company|Club|House)$/i;

export function plateName(name: string): string {
  const words = name.split(/\s+/);
  return words.length >= 2 && CATEGORY.test(words.at(-1)!) ? words.slice(0, -1).join(" ") : name;
}

const LABEL_H = 15;
const labelWidth = (name: string): number => 12 + 6 + name.length * 6.1;

/** Eight offsets at radius 13, tried in this order. #1 places first. */
const OFFSETS: Array<[string, (u: number, v: number, w: number) => Box]> = [
  ["E", (u, v, w) => ({ x: u + 13, y: v - LABEL_H / 2, w, h: LABEL_H })],
  ["NE", (u, v, w) => ({ x: u + 9.2, y: v - 9.2 - LABEL_H, w, h: LABEL_H })],
  ["SE", (u, v, w) => ({ x: u + 9.2, y: v + 9.2, w, h: LABEL_H })],
  ["W", (u, v, w) => ({ x: u - 13 - w, y: v - LABEL_H / 2, w, h: LABEL_H })],
  ["NW", (u, v, w) => ({ x: u - 9.2 - w, y: v - 9.2 - LABEL_H, w, h: LABEL_H })],
  ["SW", (u, v, w) => ({ x: u - 9.2 - w, y: v + 9.2, w, h: LABEL_H })],
  ["N", (u, v, w) => ({ x: u - w / 2, y: v - 13 - LABEL_H, w, h: LABEL_H })],
  ["S", (u, v, w) => ({ x: u - w / 2, y: v + 13, w, h: LABEL_H })],
];

// ── the sheet ───────────────────────────────────────────────────────────────

export interface MapModel {
  places: MapPlace[];
  finding: Finding;
  extent: Extent;
  marks: Array<{ place: MapPlace; u: number; v: number; named: boolean }>;
  campus: { u: number; v: number };
  labels: MapLabel[];
  leaders: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  imprint: Box | null;
  north: { u: number; v: number } | null;
  bracket: Box | null;
}

/** Which third of the sheet a point is in, as a 3x3 cell index 0..8. */
const cellOf = (u: number, v: number): number =>
  Math.min(2, Math.max(0, Math.floor((u / VB_W) * 3))) + Math.min(2, Math.max(0, Math.floor((v / VB_H) * 3))) * 3;

export function buildMap(places: MapPlace[], who = "They"): MapModel {
  const first = places.find((p) => p.position === 1);
  const finding = computeFinding(places, first, who);
  const extent = computeExtent(places.map((p) => project(p)).concat([{ x: 0, y: 0 }]));

  const marks = places.map((place) => {
    const xy = project(place);
    return { place, u: toU(xy.x, extent), v: toV(xy.y, extent), named: place.position <= NAMED };
  });
  const campus = { u: toU(0, extent), v: toV(0, extent) };

  // ── furniture: the emptiest cell wins, so it is a function and not taste
  const load = new Array(9).fill(0);
  for (const m of marks) load[cellOf(m.u, m.v)]++;
  const topCells = [0, 1, 2].sort((a, b) => load[a] - load[b] || a - b);
  const imprintCell = topCells[0];
  const northCell = topCells[1];

  const cellBox = (i: number): Box => ({
    x: (i % 3) * (VB_W / 3),
    y: Math.floor(i / 3) * (VB_H / 3),
    w: VB_W / 3,
    h: VB_H / 3,
  });
  const ic = cellBox(imprintCell);
  const IMPRINT_W = 112;
  // Two lines of text at a FIXED 11px/1.5 plus 10px of padding either side,
  // inside a box that scales with the sheet. At the narrow end the sheet is
  // ~0.9 of user space, so the box has to be sized for the smallest it will
  // ever be drawn or the text grows out of it. This is also why the scale bar
  // that used to live in here is gone: a drawn rule and unscaled type in the
  // same box cannot both be right, and the rings already carry the scale, in
  // walking minutes, which is the unit the whole product speaks.
  const IMPRINT_H = 62;
  const imprint: Box = {
    x: Math.min(Math.max(ic.x + 2, PAD - 26), VB_W - PAD - IMPRINT_W + 26),
    y: PAD - 26,
    w: IMPRINT_W,
    h: IMPRINT_H,
  };
  const nc = cellBox(northCell);
  const north = { u: Math.min(Math.max(nc.x + nc.w / 2, PAD + 12), VB_W - PAD - 12), v: PAD + 6 };
  const northBox: Box = { x: north.u - 10, y: north.v - 6, w: 20, h: 34 };

  // ── contour labels: the emptiest compass bearing, so a ring's minutes
  // never land on the busiest side of somebody's campus
  const perBearing = new Array(8).fill(0);
  for (const m of marks) perBearing[bearingIndex(project(m.place))]++;
  const order = [4, 5, 3, 6, 2, 7, 1, 0]; // S, SW, SE, W, E, NW, NE, N
  const labelBearing = [...order].sort((a, b) => perBearing[a] - perBearing[b])[0];
  const theta = (labelBearing * 45 * Math.PI) / 180;

  const labels: MapLabel[] = [];
  const leaders: MapModel["leaders"] = [];
  const placed: Box[] = [imprint, northBox];
  const neatline: Box = { x: 8, y: 8, w: VB_W - 16, h: VB_H - 16 };
  const inside = (b: Box) =>
    b.x >= neatline.x + 4 && b.y >= neatline.y + 4 && b.x + b.w <= neatline.x + neatline.w - 4 && b.y + b.h <= neatline.y + neatline.h - 4;

  for (const metres of CONTOUR_M) {
    const r = metres * extent.scale;
    const u = campus.u + Math.sin(theta) * r;
    const v = campus.v - Math.cos(theta) * r;
    const text = `${Math.round(metres / 80)} min`;
    const box: Box = { x: u - text.length * 3.1, y: v - 7, w: text.length * 6.2, h: 14 };
    if (!inside(box)) continue;
    placed.push(box);
    labels.push({ kind: "contour", text, leftPct: (box.x / VB_W) * 100, topPct: (box.y / VB_H) * 100 });
  }

  labels.push({
    kind: "campus",
    text: "The Oval",
    leftPct: ((campus.u - 76) / VB_W) * 100,
    topPct: ((campus.v - 7) / VB_H) * 100,
  });

  // ── place labels: rank order, so #1 always gets its best slot
  for (const mark of marks.filter((m) => m.named).sort((a, b) => a.place.position - b.place.position)) {
    const short = plateName(mark.place.name);
    const w = labelWidth(short);
    const clears = (box: Box): boolean => {
      if (!inside(box)) return false;
      for (const other of marks) {
        const r = other.named ? 7.5 : 3;
        if (overlaps(box, { x: other.u - r, y: other.v - r, w: r * 2, h: r * 2 }, 3)) return false;
      }
      return !placed.some((p) => overlaps(box, p, 4));
    };

    let box: Box | null = null;
    for (const [, at] of OFFSETS) {
      const candidate = at(mark.u, mark.v, w);
      if (clears(candidate)) {
        box = candidate;
        break;
      }
    }
    if (box) {
      placed.push(box);
    } else {
      // Nowhere within reach: take the nearest accepting lattice position and
      // draw a leader, which is what a printed map does.
      let best: Box | null = null;
      let bestD = Infinity;
      for (let x = PAD; x < VB_W - PAD; x += 12) {
        for (let y = PAD; y < VB_H - PAD; y += 12) {
          const candidate: Box = { x, y, w, h: LABEL_H };
          if (!clears(candidate)) continue;
          const d = Math.hypot(x + w / 2 - mark.u, y + LABEL_H / 2 - mark.v);
          if (d < bestD) {
            bestD = d;
            best = candidate;
          }
        }
      }
      if (!best) continue; // a sheet this crowded is better unlabelled than wrong
      box = best;
      placed.push(box);
      leaders.push({ x1: box.x + (box.x > mark.u ? 0 : w), y1: box.y + LABEL_H / 2, x2: mark.u, y2: mark.v });
    }
    labels.push({
      kind: "place",
      text: short,
      position: mark.place.position,
      palette: mark.place.palette,
      leftPct: (box.x / VB_W) * 100,
      topPct: (box.y / VB_H) * 100,
    });
  }

  // ── the cluster the finding is about, bracketed once and captioned once
  let bracket: Box | null = null;
  if (finding.bracket && finding.nearest.length === 3) {
    const pts = finding.nearest
      .map((p) => marks.find((m) => m.place.position === p.position))
      .filter((m): m is NonNullable<typeof m> => !!m);
    const xs = pts.map((m) => m.u);
    const ys = pts.map((m) => m.v);
    bracket = {
      x: Math.min(...xs) - 8,
      y: Math.min(...ys) - 8,
      w: Math.max(8, Math.max(...xs) - Math.min(...xs) + 16),
      h: Math.max(8, Math.max(...ys) - Math.min(...ys) + 16),
    };
    const ranks = finding.nearest
      .map((p) => p.position)
      .sort((a, b) => a - b)
      .join(" · ");
    labels.push({
      kind: "callout",
      text: ranks,
      lines: [ranks, "ON THIS LIST"],
      leftPct: (bracket.x / VB_W) * 100,
      // The bracket's rule is drawn 4u BELOW its box, so 3u of clearance put
      // the hairline through the caption at every width.
      topPct: ((bracket.y + bracket.h + 10) / VB_H) * 100,
    });
  }

  labels.push({
    kind: "north",
    text: "N",
    leftPct: ((north.u - 5) / VB_W) * 100,
    topPct: ((north.v + 22) / VB_H) * 100,
  });

  return {
    places,
    finding,
    extent,
    marks,
    campus,
    labels,
    leaders,
    imprint,
    north,
    bracket,
  };
}

// ── the SVG ─────────────────────────────────────────────────────────────────

const n = (x: number) => Math.round(x * 10) / 10;

export interface MapSvgOptions {
  /**
   * The OG card's variant: bigger marks, no furniture, and — the whole point
   * — no `<text>` anywhere. resvg cannot read our committed .woff files and
   * silently drops live text inside a nested SVG, which is the same trap
   * `avatarEl` in og.ts already works around.
   */
  og?: boolean;
  /**
   * Write colours as literal hex rather than `hsl(var(--token))`.
   *
   * Required by both renderers that are not the page's own DOM: satori, and
   * this SVG served inside an `<img>` — a separate document with no access to
   * `:root`, where an unresolved `var()` would draw nothing at all.
   */
  literal?: boolean;
  idPrefix?: string;
}

export function profileMapSvg(model: MapModel, opts: MapSvgOptions = {}): string {
  const svg = buildSvg(model, opts);
  return opts.literal ? resolveTokenColours(svg) : svg;
}

function buildSvg(model: MapModel, opts: MapSvgOptions): string {
  const og = opts.og === true;
  const id = opts.idPrefix ?? "pm";
  const parts: string[] = [];
  const hair = 'vector-effect="non-scaling-stroke"';

  parts.push(
    `<clipPath id="${id}-c"><rect x="8" y="8" width="${VB_W - 16}" height="${VB_H - 16}"/></clipPath>`,
  );
  parts.push(`<g clip-path="url(#${id}-c)">`);

  // walking-time contours, in the unit the whole product speaks
  for (const metres of CONTOUR_M) {
    const r = metres * model.extent.scale;
    parts.push(
      `<circle cx="${n(model.campus.u)}" cy="${n(model.campus.v)}" r="${n(r)}" fill="none" stroke="hsl(var(--muted))" stroke-width="1" stroke-dasharray="4 5" ${hair}/>`,
    );
  }
  parts.push(`</g>`);

  // The imprint's box is NOT drawn here. Its contents are HTML at a fixed
  // 11px while this drawing scales from ~354 to 512 px wide, so a rect sized
  // in user units is either too small for the text at the narrow end or has a
  // hole under it at the wide end — there is no height that is right at both.
  // The box is a CSS border on the label instead, which is exactly the size
  // of what is inside it at every width. `model.imprint` still reserves the
  // space, so place labels keep clear of it.

  if (!og && model.north) {
    const { u, v } = model.north;
    parts.push(
      `<path d="M${n(u)} ${n(v + 22)}V${n(v)}m-4 5l4-5 4 5" fill="none" stroke="hsl(var(--muted))" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" ${hair}/>`,
    );
  }

  // the campus point: a ring and a cross, the way a survey sheet marks a datum
  const c = model.campus;
  const arm = og ? 8 : 6;
  parts.push(
    `<circle cx="${n(c.u)}" cy="${n(c.v)}" r="${arm}" fill="none" stroke="hsl(var(--muted))" stroke-width="1.2" ${hair}/>` +
      `<path d="M${n(c.u - arm - 4)} ${n(c.v)}h${arm * 2 + 8}M${n(c.u)} ${n(c.v - arm - 4)}v${arm * 2 + 8}" stroke="hsl(var(--muted))" stroke-width="1.2" ${hair}/>`,
  );

  if (!og && model.bracket) {
    const b = model.bracket;
    parts.push(
      `<path d="M${n(b.x)} ${n(b.y + b.h)}v4h${n(b.w)}v-4" fill="none" stroke="hsl(var(--muted))" stroke-width="1" ${hair}/>`,
    );
  }

  // places nobody is naming: an open ring in the place's own imagery hue
  for (const m of model.marks.filter((x) => !x.named)) {
    parts.push(
      `<circle cx="${n(m.u)}" cy="${n(m.v)}" r="${og ? 5 : 3}" fill="none" stroke="hsl(var(--pal-${m.place.palette}))" stroke-width="${og ? 2.2 : 1.3}"/>`,
    );
  }

  // the one ember object on the sheet: campus to their first place
  const first = model.marks.find((m) => m.place.position === 1);
  if (first) {
    const dx = first.u - c.u;
    const dy = first.v - c.v;
    const len = Math.hypot(dx, dy) || 1;
    const r1 = arm + 2;
    const r2 = og ? 11 : 8;
    parts.push(
      `<path d="M${n(c.u + (dx / len) * r1)} ${n(c.v + (dy / len) * r1)}L${n(first.u - (dx / len) * r2)} ${n(first.v - (dy / len) * r2)}" stroke="hsl(var(--ember))" stroke-width="${og ? 3 : 1.9}" stroke-linecap="round" ${hair}/>`,
    );
  }

  // the five, last, so a named place is never occluded
  for (const m of model.marks.filter((x) => x.named)) {
    parts.push(
      `<circle cx="${n(m.u)}" cy="${n(m.v)}" r="${og ? 12 : 7.5}" fill="hsl(var(--bg))"/>` +
        `<circle cx="${n(m.u)}" cy="${n(m.v)}" r="${og ? 9 : 5.4}" fill="hsl(var(--pal-${m.place.palette}))"/>`,
    );
  }

  if (!og) {
    for (const l of model.leaders) {
      parts.push(
        `<path d="M${n(l.x1)} ${n(l.y1)}L${n(l.x2)} ${n(l.y2)}" stroke="hsl(var(--muted))" stroke-width="1" ${hair}/>`,
      );
    }
    parts.push(
      `<rect x="8" y="8" width="${VB_W - 16}" height="${VB_H - 16}" fill="none" stroke="hsl(var(--rule-strong))" stroke-width="1" ${hair}/>`,
    );
  }

  return `<svg viewBox="0 0 ${VB_W} ${VB_H}" width="100%" height="100%" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}
