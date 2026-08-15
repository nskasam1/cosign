// Everything the public share surfaces read, in one place, so the template
// is only ever a template. No auth is consulted anywhere in this file — a
// share token is the authorisation (decision 12), and it is scoped to
// exactly one list or ranking.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { IntentTag, ShareToken } from "../../src/types/cosign.ts";
import { INTENT_TAG_LABELS_SHORT } from "../../src/types/cosign.ts";
import { APP_ROOT } from "../db/db.ts";
import * as social from "../repo/social.ts";
import * as shopsRepo from "../repo/shops.ts";
import * as rank from "../repo/rank.ts";
import * as listsRepo from "../repo/lists.ts";

/** The six imagery treatments in seed/images/generate.mjs. */
export const PALETTES = ["warm", "amber", "rose", "moss", "slate", "clay"] as const;
export type Palette = (typeof PALETTES)[number];

export interface ShareEntry {
  position: number;
  slug: string;
  name: string;
  /** Initials for the no-photo plate: "Cardinal & Vine" -> "C&V". */
  initials: string;
  palette: Palette;
  photo: string | null;
  /** The author's own honest line, falling back to the place's one-liner. */
  line: string | null;
  tags: IntentTag[];
  tagLabels: string[];
  /** Facts, never ratings (decision 7): price, outlets, and the like. */
  facts: string[];
  cosigners: rank.ShareCosigner[];
  cosignOthers: number;
  cosignState: "named" | "counted" | "none";
}

export interface ShareData {
  token: string;
  kind: "ranking" | "list";
  title: string;
  author: {
    name: string;
    firstName: string;
    username: string;
    school: string;
    avatar: string | null;
    tasteLine: string | null;
    signatureOrder: string | null;
  };
  entries: ShareEntry[];
  /** Chip source: every tag present, most-used first, with its count. */
  tagCounts: Array<{ tag: IntentTag; label: string; count: number }>;
  updatedAt: string | null;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** "Cardinal & Vine" -> "C&V"; "Terrazzo" -> "TZ". */
export function initialsOf(name: string): string {
  const words = name.replace(/^The\s+/i, "").split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    const w = words[0];
    return (w[0] + (w.slice(1).match(/[aeiou]?([bcdfghjklmnpqrstvwxyz])/i)?.[1] ?? w[1] ?? "")).toUpperCase();
  }
  return words
    .map((w) => (w === "&" ? "&" : w[0]))
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function paletteOf(raw: string | null): Palette {
  return (PALETTES as readonly string[]).includes(raw ?? "") ? (raw as Palette) : "warm";
}

export function loadShareData(db: DatabaseSync, token: ShareToken): ShareData | null {
  const author = social.userById(db, token.user_id);
  if (!author) return null;
  const school =
    (db.prepare("SELECT name FROM schools WHERE id = ?").get(author.school_id) as { name: string } | undefined)?.name ??
    "";

  // A token is scoped to exactly one surface. 'ranking' renders the canonical
  // ranking, 'list' that one list; a 'profile' token belongs to /p/:token
  // (Phase 5A) and must never fall through to the whole ranking.
  let shopIds: string[];
  let title: string;
  let updatedAt: string | null;
  if (token.kind === "list") {
    const list = token.list_id ? listsRepo.listById(db, token.list_id) : null;
    if (!list) return null;
    shopIds = listsRepo.itemsOf(db, token.list_id!).map((i) => i.shop_id);
    title = list.title;
    updatedAt = list.created_at;
  } else if (token.kind === "ranking") {
    shopIds = rank.rankedShopIds(db, token.user_id);
    title = `${author.display_name.split(" ")[0]}'s campus coffee, ranked`;
    updatedAt =
      (db.prepare("SELECT updated_at FROM rankings WHERE user_id = ?").get(token.user_id) as
        | { updated_at: string }
        | undefined)?.updated_at ?? null;
  } else {
    return null;
  }

  const lineOf = db.prepare(
    "SELECT line FROM logs WHERE user_id = ? AND shop_id = ? AND line IS NOT NULL ORDER BY created_at DESC LIMIT 1",
  );
  const tagsOf = db.prepare(
    "SELECT intent_tag, count(*) AS n FROM logs WHERE user_id = ? AND shop_id = ? GROUP BY intent_tag ORDER BY n DESC, intent_tag LIMIT 3",
  );

  const entries: ShareEntry[] = shopIds.map((shopId, i) => {
    const shop = shopsRepo.shopById(db, shopId);
    const amenities = shop ? shopsRepo.amenitiesOf(db, shopId) : null;
    const tags = (tagsOf.all(token.user_id, shopId) as unknown as Array<{ intent_tag: IntentTag }>).map(
      (r) => r.intent_tag,
    );
    const cos = rank.cosignersForShare(db, shopId, token.user_id);

    const facts: string[] = [];
    if (shop?.price_drip != null) facts.push(`${money(shop.price_drip)} drip`);
    if (amenities?.outlet_count) facts.push(`${amenities.outlet_count} outlets`);
    else if (amenities?.camp_ok) facts.push("fine to camp");
    if (facts.length < 2 && shop?.student_discount) facts.push("student discount");

    return {
      position: i + 1,
      slug: shop?.slug ?? shopId,
      name: shop?.name ?? shopId,
      initials: initialsOf(shop?.name ?? shopId),
      palette: paletteOf(shop?.palette ?? null),
      photo: shopsRepo.photosOf(db, shopId)[0]?.path ?? null,
      line: (lineOf.get(token.user_id, shopId) as { line: string } | undefined)?.line ?? shop?.one_liner ?? null,
      tags,
      tagLabels: tags.map((t) => INTENT_TAG_LABELS_SHORT[t] ?? t),
      facts: facts.slice(0, 2),
      cosigners: cos.named.slice(0, 3),
      cosignOthers: cos.others + Math.max(0, cos.named.length - 3),
      cosignState: cos.named.length ? "named" : cos.others ? "counted" : "none",
    };
  });

  const counts = new Map<IntentTag, number>();
  for (const e of entries) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);

  return {
    token: token.token,
    kind: token.kind,
    title,
    author: {
      name: author.display_name,
      firstName: author.display_name.split(" ")[0],
      username: author.username,
      school,
      avatar: author.avatar,
      tasteLine: author.taste_line,
      signatureOrder: author.signature_order,
    },
    entries,
    tagCounts: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, label: INTENT_TAG_LABELS_SHORT[tag] ?? tag, count })),
    updatedAt,
  };
}

/**
 * Inline a committed SVG as a data URI.
 *
 * The share page's LCP budget is 1.0 s on simulated Slow-4G, and the floor
 * for the document alone is ~0.9 s — a second round trip for the lead
 * photograph would blow it. Only the two above-the-fold images are inlined;
 * everything below the fold is a normal lazily-loaded request.
 */
const inlineCache = new Map<string, string | null>();

/**
 * Every seeded image finishes with a full-frame `feTurbulence` grain pass.
 * That filter is rasterised over its 800x600 user-space region no matter how
 * small the image is drawn, and it is the single most expensive thing on the
 * page: on the LCP element, under Lighthouse's 4x CPU throttle, it costs
 * ~110 ms of *render* delay after the pixels have already arrived. Stripping
 * it from the inlined copy is invisible at 354 px wide and removes the only
 * unstable term in the measurement.
 */
function stripGrain(svg: string): string {
  return svg
    .replace(/<filter id="g">[\s\S]*?<\/filter>/g, "")
    .replace(/<rect[^>]*filter="url\(#g\)"[^>]*\/>/g, "");
}

export function inlineSvg(path: string, opts: { grain?: boolean } = {}): string | null {
  const key = `${path}#${opts.grain === false ? "flat" : "grain"}`;
  if (inlineCache.has(key)) return inlineCache.get(key)!;
  let uri: string | null = null;
  // Only ever reads from the committed seed imagery — never an arbitrary path.
  if (/^\/img\/[a-z0-9/_-]+\.svg$/i.test(path)) {
    try {
      const raw = readFileSync(join(APP_ROOT, "seed", "images", path.replace(/^\/img\//, "")), "utf-8");
      const svg = opts.grain === false ? stripGrain(raw) : raw;
      // Percent-encode rather than swapping " for ' — the avatars carry
      // single quotes inside double-quoted attributes (font-family stacks),
      // and swapping would close the attribute early and break the parse.
      uri =
        "data:image/svg+xml," +
        svg
          .replace(/\s+/g, " ")
          .replace(/%/g, "%25")
          .replace(/#/g, "%23")
          .replace(/&/g, "%26")
          .replace(/</g, "%3C")
          .replace(/>/g, "%3E")
          .replace(/"/g, "%22");
    } catch {
      uri = null;
    }
  }
  inlineCache.set(key, uri);
  return uri;
}
