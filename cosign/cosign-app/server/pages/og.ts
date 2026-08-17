// Open Graph image for a share link — the thing people actually see when
// the link lands in iMessage or a DM (decision 2).
//
// satori (JSX-less element tree -> SVG) + @resvg/resvg-wasm (SVG -> PNG).
// Both are pure WASM/JS: no native module, no headless browser, no key, no
// network. Fonts are the same two OFL faces the page ships, read from
// server/assets/fonts as .woff because satori cannot parse .woff2.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import type { ShareToken } from "../../src/types/cosign.ts";
import { APP_ROOT } from "../db/db.ts";
import { loadShareData, inlineSvg, type ShareData } from "./shareData.ts";
import { loadProfileData, type ProfileData } from "./profileData.ts";
import { profileMapSvg } from "./profileMap.ts";
import { HEX, PAL_HEX } from "./tokenHex.ts";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// satori has no CSS custom properties, so it reads the one committed copy of
// the token values (server/pages/tokenHex.ts), which the token test guards.
const C = HEX;
const PAL = PAL_HEX;

const font = (f: string) => readFileSync(join(APP_ROOT, "server", "assets", "fonts", f));
const FONTS = [
  { name: "Display", data: font("young-serif-400.woff"), weight: 400 as const, style: "normal" as const },
  { name: "Body", data: font("karla-400.woff"), weight: 400 as const, style: "normal" as const },
  { name: "Body", data: font("karla-700.woff"), weight: 700 as const, style: "normal" as const },
];

type El = { type: string; props: Record<string, unknown> };
const h = (type: string, props: Record<string, unknown> = {}, ...children: unknown[]): El => ({
  type,
  props: { ...props, children: children.length === 1 ? children[0] : children },
});
const row = (style: Record<string, unknown>, ...kids: unknown[]) =>
  h("div", { style: { display: "flex", ...style } }, ...kids);
const col = (style: Record<string, unknown>, ...kids: unknown[]) =>
  h("div", { style: { display: "flex", flexDirection: "column", ...style } }, ...kids);

/**
 * The seeded avatars are SVG monograms. resvg will happily draw their discs
 * but not the letter inside them — its font database cannot read the .woff
 * files we ship, and loading this machine's system fonts is not something a
 * committed asset may depend on. So the monogram is rebuilt in satori (which
 * converts text to paths before resvg ever sees it) using the colours read
 * back out of the committed file, which keeps the card faithful to the
 * avatar rather than inventing a second one.
 */
function avatarMarks(path: string): { ground: string; accent: string; cream: string; initial: string } | null {
  const svg = inlineSvg(path);
  if (!svg) return null;
  const raw = decodeURIComponent(svg.replace(/^data:image\/svg\+xml,/, ""));
  const ground = raw.match(/<rect width="240" height="240" fill="(#[0-9a-f]{6})"/i)?.[1];
  const accent = raw.match(/r="104"[^>]*stroke="(#[0-9a-f]{6})"/i)?.[1];
  const cream = raw.match(/<text[^>]*fill="(#[0-9a-f]{6})"/i)?.[1];
  const initial = raw.match(/<text[^>]*>([^<])/)?.[1];
  if (!ground || !accent || !cream || !initial) return null;
  return { ground, accent, cream, initial };
}

function avatarEl(path: string | null, name: string, size: number) {
  const marks = path ? avatarMarks(path) : null;
  const base = {
    display: "flex",
    width: size,
    height: size,
    borderRadius: size / 2,
    marginRight: 16,
    alignItems: "center",
    justifyContent: "center",
  };
  if (!marks) {
    return h("div", { style: { ...base, background: C.surface, color: C.line, fontFamily: "Display", fontSize: size * 0.44 } }, name[0]?.toUpperCase() ?? "");
  }
  return h(
    "div",
    {
      style: {
        ...base,
        background: marks.ground,
        border: `2px solid ${marks.accent}`,
        color: marks.cream,
        fontFamily: "Display",
        fontSize: size * 0.44,
      },
    },
    marks.initial,
  );
}

let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  wasmReady ??= initWasm(readFileSync(join(APP_ROOT, "node_modules", "@resvg", "resvg-wasm", "index_bg.wasm")));
  return wasmReady;
}

/**
 * The composition is a centre column 620 px wide. Link previews are cropped
 * to a square by some clients (a 1200x630 centre crop keeps x 285..915), so
 * everything that has to survive lives inside that band; the outer thirds
 * carry only the palette rail, which is decoration.
 *
 * Exported for `og.test.ts`, which is the only place the CONTENT of the card
 * can be checked: satori turns every glyph into a path before resvg ever
 * rasterises it, so there is not one readable word left in the PNG. The e2e
 * that fetches `/og/s/:token` can therefore only weigh it and measure it —
 * it claimed the author, the title, the places and the count for a phase
 * without asserting any of them.
 */
export function ogTree(data: ShareData) {
  const a = data.author;
  const top = data.entries.slice(0, 3);
  const cosignTotal = data.entries.reduce((n, x) => n + x.cosigners.length + x.cosignOthers, 0);
  const rail = data.entries.slice(0, 12).map((x) => PAL[x.palette] ?? C.gold);

  const railCol = (align: "flex-start" | "flex-end") =>
    col({ flex: 1, justifyContent: "center", alignItems: align, height: "100%" },
      ...rail.map((c, i) =>
        h("div", {
          style: { display: "flex", width: i % 3 === 0 ? 74 : 46, height: 6, background: c, opacity: 0.5, marginBottom: 14 },
        }),
      ),
    );

  return row(
    { width: OG_WIDTH, height: OG_HEIGHT, background: C.bg, alignItems: "center" },
    railCol("flex-start"),
    col(
      { width: 620, height: "100%", justifyContent: "center", paddingTop: 46, paddingBottom: 46 },
      row({ alignItems: "center", marginBottom: 22 },
        h("div", { style: { display: "flex", fontFamily: "Body", fontWeight: 700, fontSize: 19, letterSpacing: 4, color: C.gold } }, "COSIGN"),
        h("div", { style: { display: "flex", width: 30, height: 1, background: C.ruleStrong, marginLeft: 14, marginRight: 14 } }),
        h("div", { style: { display: "flex", fontFamily: "Body", fontWeight: 400, fontSize: 19, letterSpacing: 3.4, color: C.muted } }, "ONE PERSON’S LIST"),
      ),
      h("div", {
        style: { display: "flex", fontFamily: "Display", fontSize: data.title.length > 34 ? 54 : 62, lineHeight: 1.06, color: C.ink, letterSpacing: -0.8, marginBottom: 26 },
      }, data.title.replace(/'/g, "’")),
      row({ alignItems: "center", marginBottom: 26 },
        avatarEl(a.avatar, a.name, 64),
        col({},
          h("div", { style: { display: "flex", fontFamily: "Body", fontWeight: 700, fontSize: 27, color: C.ink } }, a.name),
          h("div", { style: { display: "flex", fontFamily: "Body", fontSize: 20, color: C.muted, marginTop: 4 } }, a.school),
        ),
      ),
      h("div", { style: { display: "flex", width: "100%", height: 1, background: C.rule, marginBottom: 22 } }),
      col({ marginBottom: 24 },
        ...top.map((entry, i) =>
          row({ alignItems: "baseline", marginBottom: i === top.length - 1 ? 0 : 12 },
            h("div", {
              style: { display: "flex", fontFamily: "Display", fontSize: 30, color: PAL[entry.palette] ?? C.gold, width: 44 },
            }, String(entry.position)),
            h("div", { style: { display: "flex", fontFamily: "Display", fontSize: 30, color: C.ink } }, entry.name),
          ),
        ),
      ),
      row({ alignItems: "center" },
        h("div", { style: { display: "flex", fontFamily: "Body", fontWeight: 700, fontSize: 18, letterSpacing: 2.6, color: C.ember } },
          `${data.entries.length} PLACES`),
        h("div", { style: { display: "flex", fontFamily: "Body", fontSize: 18, letterSpacing: 2.6, color: C.muted, marginLeft: 12 } },
          `· COSIGNED ${cosignTotal} TIMES · RANKED, NEVER RATED`),
      ),
    ),
    railCol("flex-end"),
  );
}

/**
 * The profile card (Phase 5A). The card IS the map.
 *
 * The list card above is a 620px centre column of type flanked by palette
 * rails; this one is a drawn shape. That is the only test that matters —
 * two links from the same person landing in the same message thread have to
 * be distinguishable at a glance, and a differently-worded type column is
 * not.
 *
 * The map is handed to satori as a base64 data URI in a single <img>, and it
 * is generated by `profileMapSvg(model, {og:true})`, which emits NO `<text>`
 * at all: resvg cannot read our committed .woff files and silently drops live
 * text inside a nested SVG. Every word on this card is satori text, converted
 * to paths before resvg ever sees it — the same lesson `avatarEl` encodes.
 *
 * The card deliberately prints no visit count. A log changes neither
 * `rankings.updated_at` nor the entry count, so a cached card claiming
 * "23 VISITS" would misstate a fact about a real person indefinitely. The bug
 * is designed out rather than keyed around.
 */
function profileOgTree(data: ProfileData) {
  const a = data.author;
  const svg = profileMapSvg(data.map, { og: true, literal: true });

  const centred = (style: Record<string, unknown>, text: string) =>
    h("div", { style: { display: "flex", justifyContent: "center", width: "100%", ...style } }, text);

  return col(
    { width: OG_WIDTH, height: OG_HEIGHT, background: C.bg, alignItems: "center", paddingTop: 20 },
    h("img", {
      src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      width: 400,
      height: 400,
      style: { display: "flex" },
    }),
    centred(
      { fontFamily: "Body", fontWeight: 700, fontSize: 19, letterSpacing: 4, color: C.gold, marginTop: 16 },
      "COSIGN · ONE PERSON’S CAMPUS",
    ),
    row({ alignItems: "center", justifyContent: "center", width: "100%", marginTop: 20 },
      avatarEl(a.avatar, a.name, 64),
      h("div", { style: { display: "flex", fontFamily: "Display", fontSize: 56, color: C.ink } }, a.name),
    ),
    centred(
      { fontFamily: "Body", fontSize: 21, letterSpacing: 2.6, color: C.muted, marginTop: 18 },
      `${data.counts.places} PLACES, IN ORDER · ${a.school.toUpperCase()}`,
    ),
    centred(
      { fontFamily: "Body", fontWeight: 700, fontSize: 18, letterSpacing: 2.6, color: C.ember, marginTop: 14 },
      "RANKED, NEVER RATED · NEVER BOUGHT",
    ),
  );
}

export async function renderProfileOgImage(db: DatabaseSync, token: ShareToken): Promise<Buffer | null> {
  const data = loadProfileData(db, token);
  if (!data) return null;
  const key = `p:${token.token}:${data.updatedAt ?? ""}:${data.counts.places}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const svg = await satori(profileOgTree(data) as never, { width: OG_WIDTH, height: OG_HEIGHT, fonts: FONTS });
  await ensureWasm();
  const png = Buffer.from(
    new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH }, font: { loadSystemFonts: false } })
      .render()
      .asPng(),
  );

  if (cache.size > 32) cache.clear();
  cache.set(key, png);
  return png;
}

const cache = new Map<string, Buffer>();

/** Render (and memoise) the PNG for a share token. */
export async function renderOgImage(db: DatabaseSync, token: ShareToken): Promise<Buffer | null> {
  const data = loadShareData(db, token);
  if (!data) return null;
  const key = `${token.token}:${data.updatedAt ?? ""}:${data.entries.length}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const svg = await satori(ogTree(data) as never, { width: OG_WIDTH, height: OG_HEIGHT, fonts: FONTS });
  await ensureWasm();
  const png = Buffer.from(
    new Resvg(svg, {
      fitTo: { mode: "width", value: OG_WIDTH },
      // satori converts every glyph to a path before resvg sees it, so resvg
      // needs no font database at all — and must not fall back to whatever
      // fonts happen to be installed on the machine that runs the build.
      font: { loadSystemFonts: false },
    })
      .render()
      .asPng(),
  );

  if (cache.size > 32) cache.clear();
  cache.set(key, png);
  return png;
}
